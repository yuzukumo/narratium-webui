package provider

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"strings"
)

const maxStreamEventBytes = 16 << 20

type wireEvent struct {
	name string
	data []byte
}

func parseWireEvents(reader io.Reader, contentType string, handle func(wireEvent) error) error {
	mediaType, _, _ := mime.ParseMediaType(contentType)
	buffered := bufio.NewReader(reader)

	switch strings.ToLower(mediaType) {
	case "text/event-stream":
		return parseSSE(buffered, handle)
	case "application/json", "application/x-ndjson", "application/json-seq":
		return parseJSONStream(buffered, handle)
	}

	prefix, streamReader, err := sniffStreamPrefix(buffered)
	if err != nil {
		return err
	}
	if prefix == '{' || prefix == '[' {
		return parseJSONStream(streamReader, handle)
	}
	return parseSSE(streamReader, handle)
}

func sniffStreamPrefix(reader *bufio.Reader) (byte, io.Reader, error) {
	var prefix bytes.Buffer
	for {
		value, err := reader.ReadByte()
		if err != nil {
			if err == io.EOF {
				return 0, bytes.NewReader(prefix.Bytes()), nil
			}
			return 0, nil, err
		}
		prefix.WriteByte(value)
		if value != ' ' && value != '\t' && value != '\r' && value != '\n' {
			return value, io.MultiReader(bytes.NewReader(prefix.Bytes()), reader), nil
		}
	}
}

func parseSSE(reader io.Reader, handle func(wireEvent) error) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 32<<10), maxStreamEventBytes)

	var eventName string
	dataLines := make([]string, 0, 1)
	dataBytes := 0
	dispatch := func() error {
		if len(dataLines) == 0 {
			eventName = ""
			return nil
		}
		data := []byte(strings.Join(dataLines, "\n"))
		dataLines = dataLines[:0]
		dataBytes = 0
		name := eventName
		eventName = ""
		return handle(wireEvent{name: name, data: data})
	}

	firstLine := true
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if firstLine {
			line = strings.TrimPrefix(line, "\uFEFF")
			firstLine = false
		}
		if line == "" {
			if err := dispatch(); err != nil {
				return err
			}
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}

		field, value, found := strings.Cut(line, ":")
		if !found {
			value = ""
		}
		if strings.HasPrefix(value, " ") {
			value = value[1:]
		}
		switch field {
		case "event":
			eventName = value
		case "data":
			dataBytes += len(value)
			if dataBytes > maxStreamEventBytes {
				return fmt.Errorf("stream event exceeds %d bytes", maxStreamEventBytes)
			}
			dataLines = append(dataLines, value)
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read SSE stream: %w", err)
	}
	return dispatch()
}

func parseJSONStream(reader io.Reader, handle func(wireEvent) error) error {
	buffered, ok := reader.(*bufio.Reader)
	if !ok {
		buffered = bufio.NewReader(reader)
	}
	first, err := firstJSONByte(buffered)
	if err != nil {
		if err == io.EOF {
			return nil
		}
		return fmt.Errorf("read JSON stream: %w", err)
	}

	decoder := json.NewDecoder(buffered)
	decoder.UseNumber()

	if first == '[' {
		if _, err := decoder.Token(); err != nil {
			return fmt.Errorf("read JSON stream array: %w", err)
		}
		for decoder.More() {
			var raw json.RawMessage
			if err := decoder.Decode(&raw); err != nil {
				return fmt.Errorf("decode JSON stream item: %w", err)
			}
			if len(raw) > maxStreamEventBytes {
				return fmt.Errorf("stream event exceeds %d bytes", maxStreamEventBytes)
			}
			if err := handle(wireEvent{data: raw}); err != nil {
				return err
			}
		}
		if _, err := decoder.Token(); err != nil {
			return fmt.Errorf("close JSON stream array: %w", err)
		}
		return nil
	}

	for {
		var raw json.RawMessage
		if err := decoder.Decode(&raw); err != nil {
			if err == io.EOF {
				return nil
			}
			return fmt.Errorf("decode JSON stream item: %w", err)
		}
		if len(raw) > maxStreamEventBytes {
			return fmt.Errorf("stream event exceeds %d bytes", maxStreamEventBytes)
		}
		if err := handle(wireEvent{data: raw}); err != nil {
			return err
		}
	}
}

func firstJSONByte(reader *bufio.Reader) (byte, error) {
	for {
		value, err := reader.ReadByte()
		if err != nil {
			return 0, err
		}
		if value == ' ' || value == '\t' || value == '\r' || value == '\n' {
			continue
		}
		if err := reader.UnreadByte(); err != nil {
			return 0, err
		}
		return value, nil
	}
}
