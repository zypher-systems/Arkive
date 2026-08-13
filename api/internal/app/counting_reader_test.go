package app

import (
	"bytes"
	"errors"
	"io"
	"testing"
)

func TestCountingReaderUnlimited(t *testing.T) {
	c := &CountingReader{R: bytes.NewReader([]byte("hello")), Limit: -1}
	b, err := io.ReadAll(c)
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "hello" || c.N != 5 {
		t.Fatalf("got %q n=%d", b, c.N)
	}
}

func TestCountingReaderQuotaExceeded(t *testing.T) {
	c := &CountingReader{R: bytes.NewReader([]byte("hello world")), Limit: 5}
	_, err := io.ReadAll(c)
	if !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("err=%v", err)
	}
	if c.N <= 5 {
		t.Fatalf("expected n > limit, n=%d", c.N)
	}
}
