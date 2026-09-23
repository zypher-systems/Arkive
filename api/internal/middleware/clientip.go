package middleware

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync/atomic"
)

// Client IP resolution.
//
// Arkive 1.0 sat behind its own nginx, which overwrote X-Forwarded-For, so the
// header could be trusted blindly. The single binary is now reachable directly,
// so forwarding headers are only honoured when the TCP peer is a configured
// trusted proxy (ARKIVE_TRUSTED_PROXIES). With no trusted proxies (the default)
// the peer address is the client address.

var trustedProxies atomic.Pointer[[]netip.Prefix]

// ParseTrustedProxies parses a comma/space separated list of CIDRs or bare IPs.
func ParseTrustedProxies(raw string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for _, f := range strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == ' ' || r == '\t' || r == '\n' }) {
		if strings.Contains(f, "/") {
			p, err := netip.ParsePrefix(f)
			if err != nil {
				return nil, fmt.Errorf("ARKIVE_TRUSTED_PROXIES: invalid CIDR %q", f)
			}
			out = append(out, p.Masked())
			continue
		}
		a, err := netip.ParseAddr(f)
		if err != nil {
			return nil, fmt.Errorf("ARKIVE_TRUSTED_PROXIES: invalid IP %q", f)
		}
		a = a.Unmap()
		out = append(out, netip.PrefixFrom(a, a.BitLen()))
	}
	return out, nil
}

// SetTrustedProxies installs the process-wide trusted proxy list.
func SetTrustedProxies(p []netip.Prefix) {
	cp := append([]netip.Prefix(nil), p...)
	trustedProxies.Store(&cp)
}

func isTrusted(a netip.Addr, trusted []netip.Prefix) bool {
	a = a.Unmap()
	for _, p := range trusted {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

func parseIP(s string) (netip.Addr, bool) {
	s = strings.TrimSpace(s)
	// Tolerate "ip:port" and "[v6]:port" forms some proxies emit.
	if ap, err := netip.ParseAddrPort(s); err == nil {
		return ap.Addr().Unmap(), true
	}
	s = strings.TrimSuffix(strings.TrimPrefix(s, "["), "]")
	a, err := netip.ParseAddr(s)
	if err != nil {
		return netip.Addr{}, false
	}
	return a.Unmap(), true
}

func peerAddr(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// resolveClientIP implements the trusted-proxy walk.
func resolveClientIP(r *http.Request, trusted []netip.Prefix) string {
	peerStr := peerAddr(r)
	peer, ok := parseIP(peerStr)
	if !ok || len(trusted) == 0 || !isTrusted(peer, trusted) {
		return peerStr
	}
	// Walk X-Forwarded-For right to left, skipping trusted hops; the first
	// untrusted hop is the client. Anything left of it is client-controlled.
	var hops []string
	for _, v := range r.Header.Values("X-Forwarded-For") {
		hops = append(hops, strings.Split(v, ",")...)
	}
	if len(hops) > 0 {
		last := peer
		for i := len(hops) - 1; i >= 0; i-- {
			a, ok := parseIP(hops[i])
			if !ok {
				// Garbage in the chain: stop at the last address we could verify.
				return last.String()
			}
			if !isTrusted(a, trusted) {
				return a.String()
			}
			last = a
		}
		// Every hop is a trusted proxy: the left-most one is the best we have.
		return last.String()
	}
	if a, ok := parseIP(r.Header.Get("X-Real-IP")); ok {
		return a.String()
	}
	return peerStr
}

type clientIPKey struct{}

// ClientIP returns the resolved client address for r (no port). It is safe to
// call from any package (rate limiting, audit log, …): it prefers the value the
// RealIP middleware stored and otherwise resolves it on the fly.
func ClientIP(r *http.Request) string {
	if v, ok := r.Context().Value(clientIPKey{}).(string); ok && v != "" {
		return v
	}
	var trusted []netip.Prefix
	if p := trustedProxies.Load(); p != nil {
		trusted = *p
	}
	return resolveClientIP(r, trusted)
}

// RealIP resolves the client address once per request, stores it for
// ClientIP and rewrites r.RemoteAddr (so request logs show the client).
// It replaces chi's RealIP, which trusted forwarding headers from anyone.
func RealIP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := ClientIP(r)
		ctx := context.WithValue(r.Context(), clientIPKey{}, ip)
		r = r.WithContext(ctx)
		if ip != peerAddr(r) {
			r.RemoteAddr = net.JoinHostPort(ip, "0")
		}
		next.ServeHTTP(w, r)
	})
}
