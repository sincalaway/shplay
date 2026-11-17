use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use url::Url;

/// Parse only network URLs that are suitable as user-provided media sources.
/// DNS resolution and address pinning are performed by the proxy at request time.
pub fn parse_http_url(raw: &str) -> Result<Url, String> {
    if raw.len() > 8_192
        || raw.is_empty()
        || raw.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return Err("URL is empty, too long, or contains unescaped whitespace".into());
    }
    let mut url =
        Url::parse(raw).map_err(|_| "URL must be an absolute HTTP or HTTPS address".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Only HTTP and HTTPS media URLs are supported".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("URLs containing embedded credentials are not supported".into());
    }
    url.set_fragment(None);
    Ok(url)
}

/// Conservative egress policy: only globally routable unicast addresses are accepted.
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_public_ipv4(ip),
        IpAddr::V6(ip) => is_public_ipv6(ip),
    }
}

fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    if a == 0 || a == 10 || a == 127 || a >= 224 {
        return false;
    }
    if a == 100 && (64..=127).contains(&b) {
        return false; // carrier-grade NAT
    }
    if a == 169 && b == 254 {
        return false; // link local
    }
    if a == 172 && (16..=31).contains(&b) {
        return false;
    }
    if a == 192 && (b == 168 || (b == 0 && (c == 0 || c == 2))) {
        return false;
    }
    if a == 198 && ((b == 18) || (b == 19) || (b == 51 && c == 100)) {
        return false; // benchmark and documentation ranges
    }
    if a == 203 && b == 0 && c == 113 {
        return false;
    }
    // Deprecated 6to4 relay anycast.
    !(a == 192 && b == 88 && c == 99)
}

fn is_public_ipv6(ip: Ipv6Addr) -> bool {
    if let Some(mapped) = ip.to_ipv4_mapped() {
        return is_public_ipv4(mapped);
    }
    let s = ip.segments();
    // Public IPv6 unicast space currently lives in 2000::/3. This excludes
    // unspecified, loopback, ULA, link-local, multicast and most special-use ranges.
    if s[0] & 0xe000 != 0x2000 {
        return false;
    }
    // Documentation, Teredo, ORCHIDv2 and 6to4 transition ranges are not public destinations.
    if (s[0] == 0x2001 && (s[1] <= 0x01ff || s[1] == 0x0db8 || (s[1] & 0xfff0) == 0x0020))
        || s[0] == 0x2002
    {
        return false;
    }
    true
}

pub fn is_hls_playlist(url: &Url, content_type: Option<&str>) -> bool {
    let path_is_playlist = url.path().to_ascii_lowercase().ends_with(".m3u8");
    let type_is_playlist = content_type
        .unwrap_or_default()
        .to_ascii_lowercase()
        .contains("mpegurl");
    path_is_playlist || type_is_playlist
}

/// Rewrite URI lines and quoted URI attributes in an HLS playlist through a caller-provided
/// local transport. Non-HTTP resources (for example data URIs) are left untouched.
pub fn rewrite_hls_playlist<F>(text: &str, base: &Url, mut localize: F) -> String
where
    F: FnMut(&Url) -> Option<String>,
{
    let mut output = String::with_capacity(text.len());
    for (index, line) in text.lines().enumerate() {
        if index > 0 {
            output.push('\n');
        }
        let trimmed = line.trim();
        let rewritten = if trimmed.is_empty() || trimmed.starts_with('#') {
            rewrite_uri_attributes(line, base, &mut localize)
        } else {
            rewrite_uri(base, trimmed, &mut localize).unwrap_or_else(|| line.to_string())
        };
        output.push_str(&rewritten);
    }
    if text.ends_with('\n') {
        output.push('\n');
    }
    output
}

fn rewrite_uri_attributes<F>(line: &str, base: &Url, localize: &mut F) -> String
where
    F: FnMut(&Url) -> Option<String>,
{
    let mut output = String::with_capacity(line.len());
    let mut remaining = line;
    while let Some(position) = remaining.find("URI=") {
        let value_start = position + 4;
        output.push_str(&remaining[..value_start]);
        let tail = &remaining[value_start..];
        let quote = tail.chars().next().filter(|c| *c == '"' || *c == '\'');
        if let Some(quote) = quote {
            let content_start = quote.len_utf8();
            if let Some(end) = tail[content_start..].find(quote) {
                let uri = &tail[content_start..content_start + end];
                if let Some(replaced) = rewrite_uri(base, uri, localize) {
                    output.push(quote);
                    output.push_str(&replaced);
                    output.push(quote);
                } else {
                    output.push_str(&tail[..content_start + end + quote.len_utf8()]);
                }
                remaining = &tail[content_start + end + quote.len_utf8()..];
                continue;
            }
        }
        // Malformed or unquoted attributes are preserved instead of guessed at.
        output.push_str(tail);
        return output;
    }
    output.push_str(remaining);
    output
}

fn rewrite_uri<F>(base: &Url, raw: &str, localize: &mut F) -> Option<String>
where
    F: FnMut(&Url) -> Option<String>,
{
    let resolved = base.join(raw).ok()?;
    if !matches!(resolved.scheme(), "http" | "https") {
        return None;
    }
    localize(&resolved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    #[test]
    fn accepts_only_http_network_urls_without_credentials() {
        assert_eq!(
            parse_http_url("https://media.example.test/file.mp4")
                .unwrap()
                .scheme(),
            "https"
        );
        assert!(parse_http_url("file:///tmp/movie.mp4").is_err());
        assert!(parse_http_url("https://user:pass@media.example.test/a.mp4").is_err());
        assert!(parse_http_url("https://media.example.test/a b.m3u8").is_err());
    }

    #[test]
    fn blocks_private_reserved_and_special_addresses() {
        for ip in [
            "0.0.0.1",
            "10.0.0.1",
            "100.64.0.1",
            "127.0.0.1",
            "169.254.1.1",
            "172.20.0.1",
            "192.168.1.1",
            "192.0.2.1",
            "192.88.99.0",
            "198.18.0.1",
            "203.0.113.1",
            "224.0.0.1",
            "255.255.255.255",
        ] {
            assert!(
                !is_public_ip(ip.parse::<IpAddr>().unwrap()),
                "unexpectedly allowed {ip}"
            );
        }
        assert!(is_public_ip(IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1))));
    }

    #[test]
    fn blocks_non_global_ipv6_and_accepts_global_unicast() {
        for ip in [
            "::",
            "::1",
            "fc00::1",
            "fe80::1",
            "ff02::1",
            "2001:0::1",
            "2001:20::1",
            "2001:db8::1",
            "2002::1",
        ] {
            assert!(
                !is_public_ip(ip.parse::<IpAddr>().unwrap()),
                "unexpectedly allowed {ip}"
            );
        }
        assert!(is_public_ip(IpAddr::V6(
            "2606:4700:4700::1111".parse::<Ipv6Addr>().unwrap()
        )));
    }

    #[test]
    fn rewrites_playlist_lines_and_uri_attributes() {
        let base = Url::parse("https://cdn.example.test/path/master.m3u8").unwrap();
        let input = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"keys/key.bin\"\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvariants/low.m3u8\n";
        let output =
            rewrite_hls_playlist(input, &base, |url| Some(format!("local://{}", url.path())));
        assert!(output.contains("URI=\"local:///path/keys/key.bin\""));
        assert!(output.contains("local:///path/variants/low.m3u8"));
        assert!(output.ends_with('\n'));
    }

    #[test]
    fn leaves_non_http_hls_uris_unchanged() {
        let base = Url::parse("https://cdn.example.test/live.m3u8").unwrap();
        let input = "#EXTM3U\n#EXT-X-KEY:METHOD=NONE,URI=\"data:text/plain;base64,AA==\"\n";
        let output = rewrite_hls_playlist(input, &base, |_| Some("local://unexpected".into()));
        assert!(output.contains("data:text/plain;base64,AA=="));
    }
}
