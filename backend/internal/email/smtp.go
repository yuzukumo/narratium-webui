package email

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/mail"
	"net/smtp"
	"strings"
	"time"
)

var ErrNotConfigured = errors.New("SMTP email delivery is not configured")

type Mailer interface {
	Configured() bool
	SendVerificationCode(context.Context, string, string, time.Time) error
}

type SMTPMailer struct {
	host        string
	port        int
	username    string
	password    string
	from        string
	fromAddress string
	implicitTLS bool
}

func NewSMTPMailer(host string, port int, username, password, from string, implicitTLS bool) (*SMTPMailer, error) {
	if strings.TrimSpace(host) == "" || port < 1 || port > 65535 || strings.TrimSpace(from) == "" {
		return &SMTPMailer{}, nil
	}
	if strings.ContainsAny(from, "\r\n") {
		return nil, errors.New("NARRATIUM_SMTP_FROM must not contain line breaks")
	}
	parsed, err := mail.ParseAddress(from)
	if err != nil || parsed.Address == "" {
		return nil, errors.New("NARRATIUM_SMTP_FROM must be a valid email address")
	}
	return &SMTPMailer{
		host: host, port: port, username: username, password: password,
		from: from, fromAddress: parsed.Address, implicitTLS: implicitTLS,
	}, nil
}

func (m *SMTPMailer) Configured() bool {
	return m != nil && m.host != "" && m.port > 0 && m.fromAddress != ""
}

func (m *SMTPMailer) SendVerificationCode(ctx context.Context, recipient, code string, expiresAt time.Time) error {
	if !m.Configured() {
		return ErrNotConfigured
	}
	if strings.ContainsAny(recipient, "\r\n") || strings.ContainsAny(code, "\r\n") {
		return errors.New("invalid email message value")
	}

	dialer := &net.Dialer{Timeout: 15 * time.Second}
	connection, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(m.host, fmt.Sprintf("%d", m.port)))
	if err != nil {
		return fmt.Errorf("connect to SMTP server: %w", err)
	}
	defer connection.Close()
	_ = connection.SetDeadline(time.Now().Add(30 * time.Second))

	if m.implicitTLS {
		tlsConnection := tls.Client(connection, &tls.Config{ServerName: m.host, MinVersion: tls.VersionTLS12})
		if err := tlsConnection.HandshakeContext(ctx); err != nil {
			return fmt.Errorf("start SMTP TLS: %w", err)
		}
		connection = tlsConnection
	}
	client, err := smtp.NewClient(connection, m.host)
	if err != nil {
		return fmt.Errorf("initialize SMTP client: %w", err)
	}
	defer client.Close()

	if hasStartTLS, _ := client.Extension("STARTTLS"); !m.implicitTLS && hasStartTLS {
		if err := client.StartTLS(&tls.Config{ServerName: m.host, MinVersion: tls.VersionTLS12}); err != nil {
			return fmt.Errorf("start SMTP STARTTLS: %w", err)
		}
	}
	if m.username != "" {
		if err := client.Auth(smtp.PlainAuth("", m.username, m.password, m.host)); err != nil {
			return fmt.Errorf("authenticate with SMTP server: %w", err)
		}
	}
	if err := client.Mail(m.fromAddress); err != nil {
		return fmt.Errorf("set SMTP sender: %w", err)
	}
	if err := client.Rcpt(recipient); err != nil {
		return fmt.Errorf("set SMTP recipient: %w", err)
	}
	writer, err := client.Data()
	if err != nil {
		return fmt.Errorf("open SMTP message: %w", err)
	}
	message := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: Narratium email verification code\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nYour Narratium verification code is %s. It expires at %s.\r\n", m.from, recipient, code, expiresAt.UTC().Format(time.RFC3339))
	if _, err := writer.Write([]byte(message)); err != nil {
		_ = writer.Close()
		return fmt.Errorf("write SMTP message: %w", err)
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("send SMTP message: %w", err)
	}
	if err := client.Quit(); err != nil {
		return fmt.Errorf("close SMTP session: %w", err)
	}
	return nil
}
