package netutil

import "testing"

func TestValidateOutboundHTTPSURL(t *testing.T) {
	cases := []struct {
		raw  string
		want bool
	}{
		{"", false},
		{"http://example.com/dav", false},
		{"https://user:pass@example.com/dav", false},
		{"https://127.0.0.1/dav", false},
		{"https://169.254.169.254/latest", false},
		{"https://10.0.0.1/dav", false},
		{"https://localhost/dav", false},
		{"https://metadata.google.internal/", false},
		{"https://1.1.1.1/webdav", true},
	}
	for _, tc := range cases {
		err := ValidateOutboundHTTPSURL(tc.raw)
		ok := err == nil
		if ok != tc.want {
			t.Fatalf("%q: got ok=%v err=%v want ok=%v", tc.raw, ok, err, tc.want)
		}
	}
}
