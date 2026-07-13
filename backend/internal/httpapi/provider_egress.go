package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/yuzukumo/narratium-webui/backend/internal/config"
)

var errProviderAddressBlocked = errors.New("provider address is not publicly routable")

type netIPResolver interface {
	LookupNetIP(context.Context, string, string) ([]netip.Addr, error)
}

type restrictedProviderDialer struct {
	resolver     netIPResolver
	dialer       net.Dialer
	allowPrivate bool
}

func newProviderHTTPClient(cfg config.Config) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.ResponseHeaderTimeout = 90 * time.Second
	transport.MaxIdleConns = 100
	transport.MaxIdleConnsPerHost = 20
	transport.DialContext = (&restrictedProviderDialer{
		resolver:     net.DefaultResolver,
		dialer:       net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second},
		allowPrivate: cfg.AllowPrivateProviderHosts,
	}).DialContext
	return &http.Client{
		Transport: transport,
		Timeout:   cfg.UpstreamTimeout,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

func (d *restrictedProviderDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	if d.allowPrivate {
		return d.dialer.DialContext(ctx, network, address)
	}
	if network != "tcp" && network != "tcp4" && network != "tcp6" {
		return nil, fmt.Errorf("unsupported provider network %q", network)
	}
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("parse provider address: %w", err)
	}
	ips, err := d.resolver.LookupNetIP(ctx, "ip", strings.TrimSuffix(host, "."))
	if err != nil {
		return nil, fmt.Errorf("resolve provider host: %w", err)
	}
	if len(ips) == 0 {
		return nil, errors.New("provider host resolved to no addresses")
	}
	for _, ip := range ips {
		if providerIPBlocked(ip) {
			return nil, fmt.Errorf("%w: %s", errProviderAddressBlocked, ip.String())
		}
	}

	var dialErrors []error
	for _, ip := range ips {
		connection, dialErr := d.dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if dialErr == nil {
			return connection, nil
		}
		dialErrors = append(dialErrors, dialErr)
	}
	return nil, fmt.Errorf("connect to provider: %w", errors.Join(dialErrors...))
}

var blockedProviderPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"),
	netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("224.0.0.0/4"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("::/128"),
	netip.MustParsePrefix("::1/128"),
	netip.MustParsePrefix("fc00::/7"),
	netip.MustParsePrefix("fe80::/10"),
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("ff00::/8"),
}

func providerIPBlocked(ip netip.Addr) bool {
	if !ip.IsValid() {
		return true
	}
	address := ip.Unmap()
	if !address.IsGlobalUnicast() {
		return true
	}
	for _, prefix := range blockedProviderPrefixes {
		if prefix.Contains(address) {
			return true
		}
	}
	return false
}
