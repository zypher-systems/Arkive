package netutil

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// ValidateOutboundHTTPSURL checks that raw is an https URL suitable for server-side fetches
// (no credentials in URL, host not private/link-local/metadata).
func ValidateOutboundHTTPSURL(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fmt.Errorf("url required")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid url")
	}
	if u.Scheme != "https" {
		return fmt.Errorf("only https urls are allowed")
	}
	if u.Host == "" {
		return fmt.Errorf("url host required")
	}
	if u.User != nil {
		return fmt.Errorf("credentials in url are not allowed")
	}
	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("url host required")
	}
	if isBlockedHostname(host) {
		return fmt.Errorf("host is not allowed")
	}
	// Literal IP in hostname
	if ip := net.ParseIP(host); ip != nil {
		if isBlockedIP(ip) {
			return fmt.Errorf("host is not allowed")
		}
		return nil
	}
	ips, err := net.LookupIP(host)
	if err != nil {
		return fmt.Errorf("could not resolve host")
	}
	if len(ips) == 0 {
		return fmt.Errorf("could not resolve host")
	}
	for _, ip := range ips {
		if isBlockedIP(ip) {
			return fmt.Errorf("host resolves to a private or link-local address")
		}
	}
	return nil
}

func isBlockedHostname(host string) bool {
	h := strings.ToLower(host)
	switch h {
	case "localhost", "metadata", "metadata.google.internal", "metadata.goog":
		return true
	}
	if strings.HasSuffix(h, ".localhost") || strings.HasSuffix(h, ".local") || strings.HasSuffix(h, ".internal") {
		return true
	}
	return false
}

func isBlockedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsMulticast() || ip.IsUnspecified() {
		return true
	}
	// Extra cloud metadata ranges sometimes treated specially
	if ip4 := ip.To4(); ip4 != nil {
		// 169.254.0.0/16 already link-local; 100.64.0.0/10 CGNAT
		if ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127 {
			return true
		}
	}
	return false
}
