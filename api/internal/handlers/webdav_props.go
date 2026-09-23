package handlers

import (
	"encoding/xml"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

const davNS = "DAV:"

// davMaxXMLBody bounds request bodies for PROPFIND / PROPPATCH / LOCK.
const davMaxXMLBody = 1 << 20

// ---------------------------------------------------------------------------
// Hrefs
// ---------------------------------------------------------------------------

// davHref builds a percent-encoded href for a workspace-relative path.
// Every segment is escaped (spaces, '#', '?', ';', non-ASCII…), and collections
// always end in '/'.
func davHref(ws uuid.UUID, rel string, isDir bool) string {
	var b strings.Builder
	b.WriteString("/dav/")
	b.WriteString(ws.String())
	b.WriteString("/")
	if rel == "" {
		return b.String()
	}
	for i, seg := range strings.Split(rel, "/") {
		if i > 0 {
			b.WriteString("/")
		}
		b.WriteString(url.PathEscape(seg))
	}
	if isDir {
		b.WriteString("/")
	}
	return b.String()
}

func davJoin(parent, name string) string {
	if parent == "" {
		return name
	}
	return parent + "/" + name
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

type davAnyElem struct {
	XMLName xml.Name
	Inner   string `xml:",innerxml"`
	Text    string `xml:",chardata"`
}

type davAnyProps struct {
	Items []davAnyElem `xml:",any"`
}

type davPropfindReq struct {
	XMLName  xml.Name     `xml:"DAV: propfind"`
	AllProp  *struct{}    `xml:"DAV: allprop"`
	PropName *struct{}    `xml:"DAV: propname"`
	Prop     *davAnyProps `xml:"DAV: prop"`
	Include  *davAnyProps `xml:"DAV: include"`
}

type davPropfindMode int

const (
	davAllProp davPropfindMode = iota
	davPropNames
	davNamedProps
)

type davPropfindSpec struct {
	Mode  davPropfindMode
	Names []xml.Name
}

var errDAVBadXML = errors.New("malformed XML body")

func readDAVBody(r *http.Request) ([]byte, error) {
	if r.Body == nil {
		return nil, nil
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, davMaxXMLBody+1))
	if err != nil {
		return nil, err
	}
	if len(b) > davMaxXMLBody {
		return nil, errDAVBadXML
	}
	return b, nil
}

func isBlank(b []byte) bool {
	return strings.TrimSpace(string(b)) == ""
}

func parsePropfind(body []byte) (davPropfindSpec, error) {
	if isBlank(body) {
		return davPropfindSpec{Mode: davAllProp}, nil
	}
	var req davPropfindReq
	if err := xml.Unmarshal(body, &req); err != nil {
		return davPropfindSpec{}, errDAVBadXML
	}
	switch {
	case req.PropName != nil:
		return davPropfindSpec{Mode: davPropNames}, nil
	case req.Prop != nil:
		spec := davPropfindSpec{Mode: davNamedProps}
		for _, it := range req.Prop.Items {
			spec.Names = append(spec.Names, it.XMLName)
		}
		return spec, nil
	default:
		// allprop (with or without <include/>): include'd names are live props
		// we already return from allprop, or unknown ones we cannot produce.
		return davPropfindSpec{Mode: davAllProp}, nil
	}
}

type davPatchOp struct {
	Remove bool
	Name   xml.Name
	Value  string
}

type davPropertyUpdate struct {
	XMLName xml.Name `xml:"DAV: propertyupdate"`
	Items   []struct {
		XMLName xml.Name
		Prop    davAnyProps `xml:"DAV: prop"`
	} `xml:",any"`
}

func parseProppatch(body []byte) ([]davPatchOp, error) {
	var req davPropertyUpdate
	if err := xml.Unmarshal(body, &req); err != nil {
		return nil, errDAVBadXML
	}
	var ops []davPatchOp
	for _, it := range req.Items {
		if it.XMLName.Space != davNS || (it.XMLName.Local != "set" && it.XMLName.Local != "remove") {
			continue
		}
		for _, p := range it.Prop.Items {
			ops = append(ops, davPatchOp{Remove: it.XMLName.Local == "remove", Name: p.XMLName, Value: strings.TrimSpace(p.Text)})
		}
	}
	if len(ops) == 0 {
		return nil, errDAVBadXML
	}
	return ops, nil
}

type davLockInfo struct {
	XMLName   xml.Name  `xml:"DAV: lockinfo"`
	Exclusive *struct{} `xml:"DAV: lockscope>exclusive"`
	Shared    *struct{} `xml:"DAV: lockscope>shared"`
	Write     *struct{} `xml:"DAV: locktype>write"`
	Owner     *struct {
		Href string `xml:"DAV: href"`
		Text string `xml:",chardata"`
	} `xml:"DAV: owner"`
}

// parseLockInfo returns the pre-rendered owner XML. Echoing the client's raw
// innerxml is unsafe (its namespace prefixes are not declared in our
// response), so only an href or plain text owner is kept.
func parseLockInfo(body []byte) (ownerXML string, err error) {
	var li davLockInfo
	if err := xml.Unmarshal(body, &li); err != nil {
		return "", errDAVBadXML
	}
	if li.Write == nil || (li.Exclusive == nil && li.Shared == nil) {
		return "", errDAVBadXML
	}
	if li.Owner != nil {
		if h := strings.TrimSpace(li.Owner.Href); h != "" {
			return "<d:href>" + xmlEscape(h) + "</d:href>", nil
		}
		return xmlEscape(strings.TrimSpace(li.Owner.Text)), nil
	}
	return "", nil
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

type davEntry struct {
	Rel      string
	Href     string
	IsDir    bool
	Name     string
	Size     int64
	Mime     string
	Modified time.Time
	Created  time.Time
	ETag     string
}

var (
	pnDisplayName    = xml.Name{Space: davNS, Local: "displayname"}
	pnLastModified   = xml.Name{Space: davNS, Local: "getlastmodified"}
	pnCreationDate   = xml.Name{Space: davNS, Local: "creationdate"}
	pnResourceType   = xml.Name{Space: davNS, Local: "resourcetype"}
	pnContentLength  = xml.Name{Space: davNS, Local: "getcontentlength"}
	pnContentType    = xml.Name{Space: davNS, Local: "getcontenttype"}
	pnETag           = xml.Name{Space: davNS, Local: "getetag"}
	pnSupportedLock  = xml.Name{Space: davNS, Local: "supportedlock"}
	pnLockDiscovery  = xml.Name{Space: davNS, Local: "lockdiscovery"}
	pnQuotaAvailable = xml.Name{Space: davNS, Local: "quota-available-bytes"}
	pnQuotaUsed      = xml.Name{Space: davNS, Local: "quota-used-bytes"}
)

// davQuota is computed at most once per request (the quota is workspace-wide).
type davQuota struct {
	Used      int64
	Available int64
	Limited   bool
}

// davPropContext supplies lazily computed, per-request values.
type davPropContext struct {
	quota func() (davQuota, bool)
	locks func(rel string) []davLock
}

// davEntryPropNames lists the properties an entry has (used for allprop and
// propname). Quota props are included on collections so clients that only
// issue allprop (gvfs, some iOS apps) still see free space.
func davEntryPropNames(e davEntry, pc davPropContext) []xml.Name {
	names := []xml.Name{pnDisplayName, pnLastModified, pnCreationDate, pnResourceType, pnETag, pnSupportedLock, pnLockDiscovery}
	if e.IsDir {
		if q, ok := pc.quota(); ok {
			names = append(names, pnQuotaUsed)
			if q.Limited {
				names = append(names, pnQuotaAvailable)
			}
		}
	} else {
		names = append(names, pnContentLength, pnContentType)
	}
	return names
}

// davPropValue renders the inner XML for one property, or ok=false when the
// resource does not have it (reported as 404 in the multistatus).
func davPropValue(e davEntry, name xml.Name, pc davPropContext) (string, bool) {
	if name.Space != davNS {
		return "", false
	}
	switch name.Local {
	case "displayname":
		return xmlEscape(e.Name), true
	case "getlastmodified":
		return e.Modified.UTC().Format(http.TimeFormat), true
	case "creationdate":
		return e.Created.UTC().Format(time.RFC3339), true
	case "resourcetype":
		if e.IsDir {
			return "<d:collection/>", true
		}
		return "", true
	case "getcontentlength":
		if e.IsDir {
			return "", false
		}
		return strconv.FormatInt(e.Size, 10), true
	case "getcontenttype":
		if e.IsDir {
			return "", false
		}
		ct := e.Mime
		if ct == "" {
			ct = "application/octet-stream"
		}
		return xmlEscape(ct), true
	case "getetag":
		if e.ETag == "" {
			return "", false
		}
		return xmlEscape(e.ETag), true
	case "supportedlock":
		return `<d:lockentry><d:lockscope><d:exclusive/></d:lockscope><d:locktype><d:write/></d:locktype></d:lockentry>`, true
	case "lockdiscovery":
		var b strings.Builder
		for _, l := range pc.locks(e.Rel) {
			b.WriteString(davActiveLockXML(l, time.Now()))
		}
		return b.String(), true
	case "quota-used-bytes":
		if !e.IsDir {
			return "", false
		}
		q, ok := pc.quota()
		if !ok {
			return "", false
		}
		return strconv.FormatInt(q.Used, 10), true
	case "quota-available-bytes":
		if !e.IsDir {
			return "", false
		}
		q, ok := pc.quota()
		if !ok || !q.Limited {
			return "", false
		}
		return strconv.FormatInt(q.Available, 10), true
	}
	return "", false
}

func davActiveLockXML(l davLock, now time.Time) string {
	depth := "0"
	if l.Infinite {
		depth = "infinity"
	}
	remaining := int64(l.Expires.Sub(now) / time.Second)
	if remaining < 0 {
		remaining = 0
	}
	var b strings.Builder
	b.WriteString(`<d:activelock><d:locktype><d:write/></d:locktype><d:lockscope><d:exclusive/></d:lockscope>`)
	b.WriteString(`<d:depth>` + depth + `</d:depth>`)
	if l.OwnerXML != "" {
		b.WriteString(`<d:owner>` + l.OwnerXML + `</d:owner>`)
	}
	b.WriteString(`<d:timeout>Second-` + strconv.FormatInt(remaining, 10) + `</d:timeout>`)
	b.WriteString(`<d:locktoken><d:href>` + xmlEscape(l.Token) + `</d:href></d:locktoken>`)
	b.WriteString(`<d:lockroot><d:href>` + xmlEscape(davHref(l.Workspace, l.Path, false)) + `</d:href></d:lockroot>`)
	b.WriteString(`</d:activelock>`)
	return b.String()
}

// davPropElem renders <name>inner</name> (or an empty element) with a
// namespace prefix that is valid in our response document.
func davPropElem(name xml.Name, inner string) string {
	var open, close string
	switch name.Space {
	case davNS:
		open, close = "d:"+name.Local, "d:"+name.Local
	case "":
		open, close = name.Local+` xmlns=""`, name.Local
	default:
		open, close = "x:"+name.Local+` xmlns:x="`+xmlAttrEscape(name.Space)+`"`, "x:"+name.Local
	}
	if inner == "" {
		return "<" + open + "/>"
	}
	return "<" + open + ">" + inner + "</" + close + ">"
}

type davPropstat struct {
	Status int
	Props  []string // rendered elements
	Error  string   // optional <d:error> body
}

type davMultistatus struct {
	b strings.Builder
}

func newDAVMultistatus() *davMultistatus {
	m := &davMultistatus{}
	m.b.WriteString(xml.Header)
	m.b.WriteString(`<d:multistatus xmlns:d="DAV:">`)
	return m
}

func (m *davMultistatus) add(href string, stats []davPropstat) {
	m.b.WriteString(`<d:response><d:href>` + xmlEscape(href) + `</d:href>`)
	for _, s := range stats {
		if len(s.Props) == 0 {
			continue
		}
		m.b.WriteString(`<d:propstat><d:prop>`)
		for _, p := range s.Props {
			m.b.WriteString(p)
		}
		m.b.WriteString(`</d:prop><d:status>` + davStatusLine(s.Status) + `</d:status>`)
		if s.Error != "" {
			m.b.WriteString(`<d:error>` + s.Error + `</d:error>`)
		}
		m.b.WriteString(`</d:propstat>`)
	}
	m.b.WriteString(`</d:response>`)
}

func (m *davMultistatus) write(w http.ResponseWriter) {
	m.b.WriteString(`</d:multistatus>`)
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.WriteHeader(http.StatusMultiStatus)
	_, _ = io.WriteString(w, m.b.String())
}

func davStatusLine(code int) string {
	return "HTTP/1.1 " + strconv.Itoa(code) + " " + http.StatusText(code)
}

// davWriteError writes an RFC 4918 <d:error> body with the given condition.
func davWriteError(w http.ResponseWriter, status int, condition string) {
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, xml.Header+`<d:error xmlns:d="DAV:">`+condition+`</d:error>`)
}

// xmlEscape escapes character data. Quotes are left readable (ETags are
// quoted strings and some clients compare the raw text).
func xmlEscape(s string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(s))
	return strings.NewReplacer("&#34;", `"`, "&#39;", "'").Replace(b.String())
}

// xmlAttrEscape escapes a value for use inside a double-quoted attribute.
func xmlAttrEscape(s string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}
