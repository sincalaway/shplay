use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use reqwest::{redirect::Policy, Client};
use shplay_media_core::{is_hls_playlist, is_public_ip, parse_http_url, rewrite_hls_playlist};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Arc, RwLock},
    time::{Duration, Instant},
};
use tokio::net::lookup_host;
use url::Url;
use uuid::Uuid;

const MAX_SOURCES: usize = 8_192;
const SOURCE_TTL: Duration = Duration::from_secs(60 * 60);
const CLIENT_TTL: Duration = Duration::from_secs(30);
const MAX_REDIRECTS: usize = 5;
const MAX_PLAYLIST_BYTES: usize = 2 * 1024 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone)]
struct MediaSource {
    url: Url,
    referer: Option<String>,
    origin: Option<String>,
    created_at: Instant,
}

#[derive(Clone)]
struct ClientEntry {
    client: Client,
    expires_at: Instant,
}

#[derive(Clone)]
pub struct ProxyState {
    base_url: String,
    secret: String,
    sources: Arc<RwLock<HashMap<String, MediaSource>>>,
    clients: Arc<RwLock<HashMap<String, ClientEntry>>>,
}

impl ProxyState {
    fn insert_source(&self, url: Url, referer: Option<String>, origin: Option<String>) -> String {
        let id = Uuid::new_v4().simple().to_string();
        let now = Instant::now();
        let source = MediaSource {
            url,
            referer,
            origin,
            created_at: now,
        };
        if let Ok(mut sources) = self.sources.write() {
            sources.retain(|_, item| now.duration_since(item.created_at) < SOURCE_TTL);
            if sources.len() >= MAX_SOURCES {
                if let Some(oldest) = sources
                    .iter()
                    .min_by_key(|(_, value)| value.created_at)
                    .map(|(key, _)| key.clone())
                {
                    sources.remove(&oldest);
                }
            }
            sources.insert(id.clone(), source);
        }
        id
    }

    fn local_url(&self, id: &str) -> String {
        format!("{}/media/{}/{}", self.base_url, self.secret, id)
    }
}

pub fn start() -> Result<ProxyState, String> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))
        .map_err(|_| "Could not start the local media proxy".to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "Could not configure the local media proxy".to_string())?;
    let port = listener
        .local_addr()
        .map_err(|_| "Could not determine the local media proxy address".to_string())?
        .port();

    let state = ProxyState {
        base_url: format!("http://127.0.0.1:{port}"),
        secret: Uuid::new_v4().simple().to_string(),
        sources: Arc::new(RwLock::new(HashMap::new())),
        clients: Arc::new(RwLock::new(HashMap::new())),
    };
    let router = Router::new()
        .route(
            "/media/{secret}/{id}",
            get(handle_media).options(handle_preflight),
        )
        .with_state(state.clone());

    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => listener,
            Err(_) => {
                eprintln!("shplay: local media proxy listener could not start");
                return;
            }
        };
        if let Err(error) = axum::serve(listener, router).await {
            eprintln!("shplay: local media proxy stopped: {error}");
        }
    });
    Ok(state)
}

#[tauri::command]
pub fn prepare_media(
    state: tauri::State<'_, ProxyState>,
    url: String,
    referer: Option<String>,
    origin: Option<String>,
) -> Result<String, String> {
    let source_url =
        parse_http_url(&url).map_err(|_| "Enter a valid HTTP or HTTPS media URL".to_string())?;
    let referer = referer
        .filter(|value| !value.trim().is_empty())
        .map(|value| normalize_header_url(&value, "Referer"))
        .transpose()?;
    let origin = origin
        .filter(|value| !value.trim().is_empty())
        .map(|value| normalize_origin(&value))
        .transpose()?
        .or_else(|| {
            referer
                .as_deref()
                .and_then(|value| Url::parse(value).ok())
                .map(|url| url.origin().ascii_serialization())
        });
    let id = state.insert_source(source_url, referer, origin);
    Ok(state.local_url(&id))
}

fn normalize_header_url(raw: &str, label: &str) -> Result<String, String> {
    let url = parse_http_url(raw).map_err(|_| format!("{label} must be an HTTP or HTTPS URL"))?;
    Ok(url.to_string())
}

fn normalize_origin(raw: &str) -> Result<String, String> {
    let url = parse_http_url(raw).map_err(|_| "Origin must be an HTTP or HTTPS URL".to_string())?;
    Ok(url.origin().ascii_serialization())
}

async fn handle_preflight(
    State(state): State<ProxyState>,
    Path((secret, _id)): Path<(String, String)>,
    request_headers: HeaderMap,
) -> Response {
    if secret != state.secret {
        return StatusCode::NOT_FOUND.into_response();
    }
    let origin = match request_origin(&request_headers) {
        Ok(origin) => origin,
        Err(status) => return status.into_response(),
    };
    let mut response = StatusCode::NO_CONTENT.into_response();
    add_cors(response.headers_mut(), origin.as_deref());
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, HEAD, OPTIONS"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Accept, Range, If-Range"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_MAX_AGE,
        HeaderValue::from_static("600"),
    );
    response
}

async fn handle_media(
    State(state): State<ProxyState>,
    Path((secret, id)): Path<(String, String)>,
    method: Method,
    request_headers: HeaderMap,
) -> Response {
    if secret != state.secret {
        return StatusCode::NOT_FOUND.into_response();
    }
    let cors_origin = match request_origin(&request_headers) {
        Ok(origin) => origin,
        Err(status) => return status.into_response(),
    };
    let source = match state
        .sources
        .read()
        .ok()
        .and_then(|sources| sources.get(&id).cloned())
    {
        Some(source) => source,
        None => {
            return response_with_cors(
                StatusCode::NOT_FOUND,
                "Media source expired",
                cors_origin.as_deref(),
            )
        }
    };

    let upstream_method = if method == Method::HEAD {
        reqwest::Method::HEAD
    } else {
        reqwest::Method::GET
    };
    let (upstream, final_url) =
        match fetch_upstream(&state, &source, &request_headers, upstream_method).await {
            Ok(response) => response,
            Err(_) => {
                return response_with_cors(
                    StatusCode::BAD_GATEWAY,
                    "The media source could not be reached",
                    cors_origin.as_deref(),
                )
            }
        };
    let status =
        StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();

    if method != Method::HEAD
        && status.is_success()
        && is_hls_playlist(&final_url, Some(&content_type))
    {
        let mut upstream = upstream;
        let bytes = match read_limited(&mut upstream, MAX_PLAYLIST_BYTES).await {
            Ok(bytes) => bytes,
            Err(()) => {
                return response_with_cors(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "Playlist is too large",
                    cors_origin.as_deref(),
                )
            }
        };
        let playlist = String::from_utf8_lossy(&bytes);
        if !playlist.trim_start().starts_with("#EXTM3U") {
            return response_with_cors(
                StatusCode::BAD_GATEWAY,
                "The playlist response was invalid",
                cors_origin.as_deref(),
            );
        }
        let rewritten = rewrite_hls_playlist(&playlist, &final_url, |child_url| {
            let child_id = state.insert_source(
                child_url.clone(),
                source.referer.clone(),
                source.origin.clone(),
            );
            Some(state.local_url(&child_id))
        });
        let mut response = Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, "application/vnd.apple.mpegurl")
            .header(header::CACHE_CONTROL, "no-store")
            .body(Body::from(rewritten))
            .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response());
        add_cors(response.headers_mut(), cors_origin.as_deref());
        return response;
    }

    let mut response_builder = Response::builder().status(status);
    for name in [
        header::CONTENT_TYPE,
        header::CONTENT_LENGTH,
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
        header::CONTENT_ENCODING,
        header::ETAG,
        header::LAST_MODIFIED,
        header::CACHE_CONTROL,
        header::EXPIRES,
    ] {
        if let Some(value) = upstream.headers().get(&name) {
            response_builder = response_builder.header(name, value.clone());
        }
    }
    let body = Body::from_stream(upstream.bytes_stream());
    let mut response = response_builder
        .body(body)
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response());
    add_cors(response.headers_mut(), cors_origin.as_deref());
    response
}

fn request_origin(headers: &HeaderMap) -> Result<Option<String>, StatusCode> {
    let Some(origin) = headers.get(header::ORIGIN) else {
        return Ok(None);
    };
    let Ok(origin) = origin.to_str() else {
        return Err(StatusCode::FORBIDDEN);
    };
    if !is_allowed_app_origin(origin) {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(Some(origin.to_string()))
}

fn is_allowed_app_origin(origin: &str) -> bool {
    const RELEASE_ORIGINS: &[&str] = &[
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ];
    const DEV_ORIGINS: &[&str] = &[
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "https://tauri.localhost",
    ];
    RELEASE_ORIGINS.contains(&origin) || (cfg!(debug_assertions) && DEV_ORIGINS.contains(&origin))
}

fn add_cors(headers: &mut HeaderMap, origin: Option<&str>) {
    if let Some(origin) = origin.and_then(|value| HeaderValue::from_str(value).ok()) {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
        headers.insert(header::VARY, HeaderValue::from_static("Origin"));
    }
    headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static(
            "Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified",
        ),
    );
}

fn response_with_cors(status: StatusCode, message: &'static str, origin: Option<&str>) -> Response {
    let mut response = (status, message).into_response();
    add_cors(response.headers_mut(), origin);
    response
}

async fn fetch_upstream(
    state: &ProxyState,
    source: &MediaSource,
    incoming_headers: &HeaderMap,
    method: reqwest::Method,
) -> Result<(reqwest::Response, Url), ()> {
    let mut current = source.url.clone();
    for redirect_count in 0..=MAX_REDIRECTS {
        let client = client_for(state, &current).await?;
        let mut request = client.request(method.clone(), current.clone());
        for name in [
            header::RANGE,
            header::IF_RANGE,
            header::ACCEPT,
            header::ACCEPT_LANGUAGE,
        ] {
            if let Some(value) = incoming_headers.get(&name) {
                request = request.header(name, value.clone());
            }
        }
        request = request
            .header(header::USER_AGENT, "shplay/0.1 (Tauri media player)")
            .header(header::ACCEPT_ENCODING, "identity");
        if let Some(referer) = source.referer.as_deref() {
            request = request.header(
                header::REFERER,
                HeaderValue::from_str(referer).map_err(|_| ())?,
            );
        }
        if let Some(origin) = source.origin.as_deref() {
            request = request.header(
                header::ORIGIN,
                HeaderValue::from_str(origin).map_err(|_| ())?,
            );
        }
        let response = request.send().await.map_err(|_| ())?;
        if !response.status().is_redirection() {
            return Ok((response, current));
        }
        if redirect_count == MAX_REDIRECTS {
            return Err(());
        }
        let location = response
            .headers()
            .get(header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .ok_or(())?;
        let next = current.join(location).map_err(|_| ())?;
        let next = parse_http_url(next.as_str()).map_err(|_| ())?;
        if current.scheme() == "https" && next.scheme() != "https" {
            return Err(());
        }
        current = next;
    }
    Err(())
}

async fn client_for(state: &ProxyState, url: &Url) -> Result<Client, ()> {
    let host = url.host_str().ok_or(())?;
    let host_lower = host.to_ascii_lowercase();
    if host_lower == "localhost"
        || host_lower.ends_with(".localhost")
        || host_lower.ends_with(".local")
        || host_lower.ends_with(".lan")
        || host_lower.ends_with(".internal")
    {
        return Err(());
    }
    let port = url.port_or_known_default().ok_or(())?;
    let key = format!("{host_lower}:{port}");
    let now = Instant::now();
    if let Ok(cache) = state.clients.read() {
        if let Some(entry) = cache.get(&key).filter(|entry| entry.expires_at > now) {
            return Ok(entry.client.clone());
        }
    }

    let mut addresses: Vec<SocketAddr> = lookup_host((host, port)).await.map_err(|_| ())?.collect();
    addresses.sort_unstable();
    addresses.dedup();
    if addresses.is_empty() || addresses.iter().any(|address| !is_public_ip(address.ip())) {
        return Err(());
    }
    let client = Client::builder()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(12))
        .read_timeout(READ_TIMEOUT)
        .resolve_to_addrs(host, &addresses)
        .build()
        .map_err(|_| ())?;
    if let Ok(mut cache) = state.clients.write() {
        cache.retain(|_, entry| entry.expires_at > now);
        if cache.len() >= 128 {
            if let Some(first_key) = cache.keys().next().cloned() {
                cache.remove(&first_key);
            }
        }
        cache.insert(
            key,
            ClientEntry {
                client: client.clone(),
                expires_at: now + CLIENT_TTL,
            },
        );
    }
    Ok(client)
}

async fn read_limited(response: &mut reqwest::Response, limit: usize) -> Result<Vec<u8>, ()> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(());
    }
    let mut output = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| ())? {
        if output.len().saturating_add(chunk.len()) > limit {
            return Err(());
        }
        output.extend_from_slice(&chunk);
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cors_is_limited_to_shplay_origins() {
        assert!(is_allowed_app_origin("tauri://localhost"));
        assert!(cfg!(debug_assertions) || !is_allowed_app_origin("http://localhost:1420"));
        assert!(!is_allowed_app_origin("https://attacker.example"));
        assert!(!is_allowed_app_origin("null"));
    }
}
