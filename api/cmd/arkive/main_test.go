package main

import (
	"flag"
	"io"
	"reflect"
	"testing"
)

func TestHealthcheckURL(t *testing.T) {
	cases := map[string]string{
		":8080":          "http://127.0.0.1:8080/api/ready",
		"0.0.0.0:9000":   "http://127.0.0.1:9000/api/ready",
		"[::]:8080":      "http://127.0.0.1:8080/api/ready",
		"10.0.0.5:8080":  "http://10.0.0.5:8080/api/ready",
		"localhost:1234": "http://localhost:1234/api/ready",
	}
	for in, want := range cases {
		if got := healthcheckURL(in); got != want {
			t.Errorf("%s → %s, want %s", in, got, want)
		}
	}
}

func TestParseInterspersed(t *testing.T) {
	for _, args := range [][]string{
		{"a@b.c", "--password", "secret123"},
		{"--password", "secret123", "a@b.c"},
	} {
		fs := flag.NewFlagSet("x", flag.ContinueOnError)
		fs.SetOutput(io.Discard)
		pw := fs.String("password", "", "")
		pos, err := parseInterspersed(fs, args)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(pos, []string{"a@b.c"}) || *pw != "secret123" {
			t.Fatalf("args %v → pos=%v pw=%q", args, pos, *pw)
		}
	}
}

func TestDispatch(t *testing.T) {
	if code := dispatch([]string{"definitely-not-a-command"}); code != 2 {
		t.Fatalf("unknown command exit=%d", code)
	}
	// Usage errors exit 2 before touching the database.
	for _, args := range [][]string{{"export"}, {"gc", "extra"}, {"user", "reset-2fa"}} {
		if code := dispatch(args); code != 2 {
			t.Fatalf("%v exit=%d", args, code)
		}
	}
	if code := dispatch([]string{"version"}); code != 0 {
		t.Fatalf("version exit=%d", code)
	}
}

func TestGeneratePassword(t *testing.T) {
	p, err := generatePassword(20)
	if err != nil || len(p) != 20 {
		t.Fatalf("p=%q err=%v", p, err)
	}
}
