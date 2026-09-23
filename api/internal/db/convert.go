package db

import (
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"time"

	"github.com/google/uuid"
)

// sqliteArg converts a Go argument to the value stored in SQLite:
// timestamps as SQLiteTimeFormat UTC text, UUIDs and []byte (JSON) as text,
// maps/structs as JSON text. Everything else goes to database/sql as is.
func sqliteArg(v any) any {
	switch x := v.(type) {
	case nil:
		return nil
	case string, int64, int, int32, bool, float64:
		return v
	case time.Time:
		return FormatSQLiteTime(x)
	case *time.Time:
		if x == nil {
			return nil
		}
		return FormatSQLiteTime(*x)
	case uuid.UUID:
		return x.String()
	case *uuid.UUID:
		if x == nil {
			return nil
		}
		return x.String()
	case []byte:
		if x == nil {
			return nil
		}
		return string(x)
	case json.RawMessage:
		if x == nil {
			return nil
		}
		return string(x)
	case driver.Valuer:
		rv := reflect.ValueOf(v)
		if rv.Kind() == reflect.Pointer && rv.IsNil() {
			return nil
		}
		val, err := x.Value()
		if err != nil {
			return v
		}
		return sqliteArg(val)
	}
	rv := reflect.ValueOf(v)
	switch rv.Kind() {
	case reflect.Pointer:
		if rv.IsNil() {
			return nil
		}
		return sqliteArg(rv.Elem().Interface())
	case reflect.Slice:
		if rv.Type().Elem().Kind() == reflect.Uint8 {
			if rv.IsNil() {
				return nil
			}
			return string(rv.Bytes())
		}
		fallthrough
	case reflect.Map, reflect.Struct:
		b, err := json.Marshal(v)
		if err != nil {
			return v
		}
		return string(b)
	}
	return v
}

// FormatSQLiteTime renders t in the stored SQLite timestamp format.
func FormatSQLiteTime(t time.Time) string {
	return t.UTC().Format(SQLiteTimeFormat)
}

var sqliteTimeLayouts = []string{
	"2006-01-02 15:04:05.999999999",
	"2006-01-02 15:04:05.999999999Z07:00",
	"2006-01-02T15:04:05.999999999Z07:00",
	"2006-01-02T15:04:05.999999999",
	"2006-01-02 15:04:05.999999999-07:00",
	"2006-01-02 15:04",
	"2006-01-02",
}

// ParseSQLiteTime parses a timestamp read from SQLite. Values without a zone
// are UTC.
func ParseSQLiteTime(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	for _, layout := range sqliteTimeLayouts {
		if t, err := time.ParseInLocation(layout, s, time.UTC); err == nil {
			return t.In(time.Local), nil
		}
	}
	return time.Time{}, fmt.Errorf("cannot parse %q as a timestamp", s)
}

var (
	timeType    = reflect.TypeOf(time.Time{})
	scannerType = reflect.TypeOf((*sql.Scanner)(nil)).Elem()
)

// wrapDests adapts scan destinations database/sql cannot fill from SQLite's
// storage classes (timestamps stored as text, JSON into maps/structs).
func wrapDests(dest []any) []any {
	out := dest
	copied := false
	for i, d := range dest {
		if w := wrapDest(d); w != nil {
			if !copied {
				out = append([]any(nil), dest...)
				copied = true
			}
			out[i] = w
		}
	}
	return out
}

func wrapDest(d any) sql.Scanner {
	switch d.(type) {
	case *time.Time, **time.Time, *json.RawMessage:
		return &convScanner{dest: d}
	case *any, *string, *[]byte, *int, *int64, *int32, *bool, *float64, **string, **int64, **int, *uuid.UUID, **uuid.UUID:
		return nil
	}
	rv := reflect.ValueOf(d)
	if rv.Kind() != reflect.Pointer || rv.IsNil() {
		return nil
	}
	if rv.Type().Implements(scannerType) {
		return nil
	}
	et := rv.Type().Elem()
	switch et.Kind() {
	case reflect.Map, reflect.Struct:
		if et == timeType {
			return nil
		}
		return &convScanner{dest: d}
	case reflect.Slice:
		return &convScanner{dest: d}
	}
	return nil
}

type convScanner struct{ dest any }

func (c *convScanner) Scan(src any) error {
	switch d := c.dest.(type) {
	case *time.Time:
		if src == nil {
			return fmt.Errorf("cannot scan NULL into *time.Time")
		}
		t, err := toTime(src)
		if err != nil {
			return err
		}
		*d = t
		return nil
	case **time.Time:
		if src == nil {
			*d = nil
			return nil
		}
		t, err := toTime(src)
		if err != nil {
			return err
		}
		*d = &t
		return nil
	}
	rv := reflect.ValueOf(c.dest).Elem()
	if src == nil {
		rv.Set(reflect.Zero(rv.Type()))
		return nil
	}
	var raw []byte
	switch s := src.(type) {
	case string:
		raw = []byte(s)
	case []byte:
		raw = append([]byte(nil), s...)
	default:
		return fmt.Errorf("cannot scan %T into %T", src, c.dest)
	}
	if rv.Kind() == reflect.Slice && rv.Type().Elem().Kind() == reflect.Uint8 {
		rv.SetBytes(raw)
		return nil
	}
	return json.Unmarshal(raw, c.dest)
}

func toTime(src any) (time.Time, error) {
	switch s := src.(type) {
	case time.Time:
		return s, nil
	case string:
		return ParseSQLiteTime(s)
	case []byte:
		return ParseSQLiteTime(string(s))
	case int64:
		return time.Unix(s, 0), nil
	}
	return time.Time{}, fmt.Errorf("cannot scan %T into a timestamp", src)
}
