package app

import "io"

// CountingReader counts bytes read and optionally rejects once Limit is exceeded.
// Limit < 0 means unlimited.
type CountingReader struct {
	R     io.Reader
	N     int64
	Limit int64
}

func (c *CountingReader) Read(p []byte) (int, error) {
	n, err := c.R.Read(p)
	c.N += int64(n)
	if c.Limit >= 0 && c.N > c.Limit {
		return n, ErrQuotaExceeded
	}
	return n, err
}
