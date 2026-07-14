"use client";

import { memo, useLayoutEffect, useRef } from "react";
import sanitizeHtml from "sanitize-html";
import { useSymbolColorStore } from "@/contexts/SymbolColorStore";
import { useLanguage } from "@/app/i18n";

function convertMarkdown(str: string): string {
  const imagePlaceholders: string[] = [];

  str = str.replace(/!\[\]\(([^)]+)\)/g, (_match,url) => {
    const placeholder = `__IMAGE_PLACEHOLDER_${imagePlaceholders.length}__`;
    imagePlaceholders.push(`<img src="${url}" alt="Image" />`);
    return placeholder;
  });
  str = str.replace(/^---$/gm, "");
  str = str.replace(/```[\s\S]*?```/g, (match,_) => {
    const content = match.replace(/^```\w*\n?/, "").replace(/```$/, "");
    return `<pre>${content}</pre>`;
  });
  str = str.replace(/^>\s*(.+)$/gm, "<blockquote>$1</blockquote>");
  str = str.replace(/<\/blockquote>\s*<blockquote>/g, "\n");
  str = str.replace(/!\[\]\(([^)]+)\)/g, "<img src=\"$1\" alt=\"Image\" />");
  str = str.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  str = str.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  str = str.replace(/(<[^>]+>)|(["“”][^"“”]+["“”])/g, (_match, tag, quote) => {
    if (tag) return tag;
    return `<talk>${quote}</talk>`;
  });
  str = str.replace(/(<[^>]+>)|(["""][^""]+["""])/g, (_match, tag, quote) => {
    if (tag) return tag;
    return `<talk>${quote}</talk>`;
  });
  str = str.replace(/\[([^\]]+)\]|【([^】]+)】/g, (_match, latinContent, cjkContent) => {
    const content = latinContent || cjkContent;
    return `<bracket-content>${content}</bracket-content>`;
  });

  imagePlaceholders.forEach((html, i) => {
    str = str.replace(`__IMAGE_PLACEHOLDER_${i}__`, html);
  });

  return str;
}

function isCompleteHtmlDocument(str: string): boolean {
  const trimmed = str.trim().toLowerCase();
  return (
    trimmed.includes("<!doctype html") ||
    (trimmed.startsWith("<html") && trimmed.includes("</html>"))
  );
}

function detectHtmlTags(str: string) {
  const htmlTagRegex = /<\s*([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>([\s\S]*?)<\s*\/\s*\1\s*>/g;
  const selfClosingTagRegex = /<\s*([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/\s*>/g;
  const tags = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = htmlTagRegex.exec(str)) !== null) tags.add(match[1].toLowerCase());
  while ((match = selfClosingTagRegex.exec(str)) !== null) tags.add(match[1].toLowerCase());
  return [...tags];
}

function generatePalette(uniqueTags: string[]): Record<string, string> {
  const { symbolColors, getColorForHtmlTag, addCustomTag } = useSymbolColorStore.getState();
  const colours: Record<string, string> = {};
  const usedColors = new Set<string>();

  uniqueTags.forEach(tag => {
    const lowerTag = tag.toLowerCase();
    const mappedColor = getColorForHtmlTag(lowerTag);
    
    if (mappedColor) {
      colours[lowerTag] = mappedColor;
      usedColors.add(mappedColor);
    }
  });

  const availableColors = [
    "#fde047", "#a78bfa", "#34d399", "#f59e0b", "#60a5fa",
    "#10b981", "#f97316", "#8b5cf6", "#ef4444", "#06b6d4", "#84cc16",
    "#facc15", "#f472b6", "#818cf8", "#22d3ee", "#4ade80", "#fb923c",
    "#d946ef", "#06b6d4", "#65a30d", "#dc2626", "#7c3aed", "#059669",
  ];

  const unassignedTags = uniqueTags.filter(tag => !colours[tag.toLowerCase()]);
  const unusedColors = availableColors.filter(color => !usedColors.has(color));
  
  unassignedTags.sort((a, b) => a.localeCompare(b)).forEach((tag, i) => {
    const lowerTag = tag.toLowerCase();
    if (!colours[lowerTag]) {
      const colorIndex = i % (unusedColors.length || availableColors.length);
      const selectedColor = unusedColors.length > 0 ? unusedColors[colorIndex] : availableColors[colorIndex];
      colours[lowerTag] = selectedColor;
      addCustomTag(lowerTag, selectedColor);
    }
  });

  return colours;
}

function replaceTags(html: string) {
  const tags = detectHtmlTags(html);
  if (tags.length === 0) return html;
  const colours = generatePalette(tags);
  const { getColorForHtmlTag } = useSymbolColorStore.getState();

  function processHtml(htmlStr: string): string {
    htmlStr = htmlStr.replace(/>\s*\n\s*</g, "><");
    
    const tagRegex = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>([\s\S]*?)<\/\1>/g;
    
    return htmlStr.replace(tagRegex, (match, tagName: string, attributes: string, innerContent: string) => {
      const lowerTagName = tagName.toLowerCase();

      const skipTags = ["script", "style", "head", "meta", "link", "title"];
      if (skipTags.includes(lowerTagName)) {
        return match;
      }

      const processedInner = processHtml(innerContent);

      let className = "";
      const classMatch = attributes.match(/class\s*=\s*["']([^"']*)["']/i);
      if (classMatch) {
        className = classMatch[1];
      }

      let tagColor = getColorForHtmlTag(lowerTagName, className);
      
      if (!tagColor && colours[lowerTagName]) {
        tagColor = colours[lowerTagName];
      }

      if (tagColor) {
        const preservedAttrs = attributes.trim();
        const styleAttr = `style="color:${tagColor}"`;
        const dataAttr = `data-tag="${tagName}"`;
        const classAttr = "class=\"tag-styled\"";
        
        let finalAttrs = "";
        if (preservedAttrs) {
          const styleMatch = preservedAttrs.match(/style\s*=\s*["']([^"']*)["']/i);
          const classMatch = preservedAttrs.match(/class\s*=\s*["']([^"']*)["']/i);
          
          let modifiedAttrs = preservedAttrs;
          
          if (styleMatch) {
            const existingStyle = styleMatch[1];
            const newStyle = `${existingStyle}; color:${tagColor}`;
            modifiedAttrs = modifiedAttrs.replace(styleMatch[0], `style="${newStyle}"`);
          } else {
            modifiedAttrs += ` ${styleAttr}`;
          }
          
          if (classMatch) {
            const existingClass = classMatch[1];
            const newClass = `${existingClass} tag-styled`;
            modifiedAttrs = modifiedAttrs.replace(classMatch[0], `class="${newClass}"`);
          } else {
            modifiedAttrs += ` ${classAttr}`;
          }
          
          finalAttrs = modifiedAttrs + ` ${dataAttr}`;
        } else {
          finalAttrs = `${classAttr} ${styleAttr} ${dataAttr}`;
        }
        
        return `<${tagName}${finalAttrs ? " " + finalAttrs : ""}>${processedInner}</${tagName}>`;
      } else {
        return `<${tagName}${attributes ? " " + attributes : ""}>${processedInner}</${tagName}>`;
      }
    });
  }
  
  function processSelfClosingTags(htmlStr: string): string {
    const selfClosingRegex = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)\s*\/\s*>/g;
    
    return htmlStr.replace(selfClosingRegex, (match, tagName: string, attributes: string) => {
      const lowerTagName = tagName.toLowerCase();
      
      const skipTags = ["br", "hr", "img", "input", "meta", "link"];
      if (skipTags.includes(lowerTagName)) {
        return match;
      }
      
      let className = "";
      const classMatch = attributes.match(/class\s*=\s*["']([^"']*)["']/i);
      if (classMatch) {
        className = classMatch[1];
      }

      let tagColor = getColorForHtmlTag(lowerTagName, className);
      
      if (!tagColor && colours[lowerTagName]) {
        tagColor = colours[lowerTagName];
      }
      
      if (tagColor) {
        const preservedAttrs = attributes.trim();
        const styleAttr = `style="color:${tagColor}"`;
        const dataAttr = `data-tag="${tagName}"`;
        const classAttr = "class=\"tag-styled\"";
        
        let finalAttrs = "";
        if (preservedAttrs) {
          const styleMatch = preservedAttrs.match(/style\s*=\s*["']([^"']*)["']/i);
          const classMatch = preservedAttrs.match(/class\s*=\s*["']([^"']*)["']/i);
          
          let modifiedAttrs = preservedAttrs;
          
          if (styleMatch) {
            const existingStyle = styleMatch[1];
            const newStyle = `${existingStyle}; color:${tagColor}`;
            modifiedAttrs = modifiedAttrs.replace(styleMatch[0], `style="${newStyle}"`);
          } else {
            modifiedAttrs += ` ${styleAttr}`;
          }
          
          if (classMatch) {
            const existingClass = classMatch[1];
            const newClass = `${existingClass} tag-styled`;
            modifiedAttrs = modifiedAttrs.replace(classMatch[0], `class="${newClass}"`);
          } else {
            modifiedAttrs += ` ${classAttr}`;
          }
          
          finalAttrs = modifiedAttrs + ` ${dataAttr}`;
        } else {
          finalAttrs = `${classAttr} ${styleAttr} ${dataAttr}`;
        }
        
        return `<${tagName}${finalAttrs ? " " + finalAttrs : ""} />`;
      } else {
        return match;
      }
    });
  }
  
  let result = processHtml(html);
  result = processSelfClosingTags(result);

  return result;
}

interface Props {
  html: string;
  isLoading?: boolean;
  isStreaming?: boolean;
  serifFontClass?: string;
  forceFullDocument?: boolean;
  enableStreaming?: boolean;
  onContentChange?: () => void;
}

const SAFE_COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d.%\s,/-]+\)|[a-z]{1,24}|transparent|currentcolor)$/i;
const SAFE_TEXT_ALIGN = /^(?:left|right|center|justify|start|end)$/i;
const SAFE_FONT_WEIGHT = /^(?:normal|bold|bolder|lighter|[1-9]00)$/i;
const SAFE_WHITE_SPACE = /^(?:normal|pre|pre-wrap|pre-line|break-spaces)$/i;

const ALLOWED_TAGS = [
  "a", "abbr", "b", "blockquote", "br", "caption", "cite", "code", "col", "colgroup",
  "dd", "del", "details", "div", "dl", "dt", "em", "figcaption", "figure", "h1", "h2",
  "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li", "mark", "ol", "p",
  "pre", "q", "rp", "rt", "ruby", "s", "samp", "section", "small", "span", "strike",
  "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr",
  "u", "ul", "var", "talk", "bracket-content", "screen", "speech", "status_block", "thought",
];

function safeHTTPSURL(value: string | undefined): string | undefined {
  if (!value || !/^https:\/\//i.test(value.trim())) {
    return undefined;
  }
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      return undefined;
    }
    return parsed.href;
  } catch {
    return undefined;
  }
}

function safeDimension(value: string | undefined): string | undefined {
  return value && /^\d{1,4}$/.test(value) ? value : undefined;
}

export function sanitizeChatHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      "*": ["class", "data-tag", "style"],
      a: ["href", "rel", "title"],
      details: ["open"],
      img: ["alt", "height", "src", "title", "width"],
      col: ["span"],
      colgroup: ["span"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan", "scope"],
    },
    allowedSchemes: ["https"],
    allowProtocolRelative: false,
    allowedStyles: {
      "*": {
        color: [SAFE_COLOR],
        "background-color": [SAFE_COLOR],
        "font-style": [/^(?:normal|italic|oblique)$/i],
        "font-weight": [SAFE_FONT_WEIGHT],
        "text-align": [SAFE_TEXT_ALIGN],
        "text-decoration": [/^(?:none|underline|line-through|overline)(?:\s+(?:underline|line-through|overline))*$/i],
        "white-space": [SAFE_WHITE_SPACE],
      },
    },
    transformTags: {
      a: (tagName, attributes) => {
        const href = safeHTTPSURL(attributes.href);
        return {
          tagName,
          attribs: {
            ...(href ? { href } : {}),
            ...(attributes.title ? { title: attributes.title } : {}),
            rel: "nofollow noreferrer noopener",
          },
        };
      },
      img: (tagName, attributes) => {
        const src = safeHTTPSURL(attributes.src);
        const width = safeDimension(attributes.width);
        const height = safeDimension(attributes.height);
        return {
          tagName,
          attribs: {
            ...(src ? { src } : {}),
            ...(attributes.alt ? { alt: attributes.alt } : {}),
            ...(attributes.title ? { title: attributes.title } : {}),
            ...(width ? { width } : {}),
            ...(height ? { height } : {}),
          },
        };
      },
    },
    exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "template"],
  });
}

export const CHAT_IFRAME_SANDBOX = "";

export function buildChatBubbleDocument(content: string): string {
  const sanitizedContent = sanitizeChatHtml(content);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src https:; font-src 'none'; media-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>*,*::before,*::after{box-sizing:border-box;max-width:100%}html,body{margin:0;padding:0;color:#f4e8c1;font:16px/${1.5} serif;background:transparent;word-wrap:break-word;overflow-wrap:break-word;hyphens:auto;white-space:pre-wrap;overflow:hidden}img{max-width:100%;height:auto;display:block;margin:0 auto}table{width:100%;border-collapse:collapse;overflow-x:auto;display:block}code,pre{font-family:monospace;font-size:0.9rem;white-space:pre-wrap;background:rgba(40,40,40,0.8);padding:4px 8px;border-radius:4px;border:1px solid rgba(255,255,255,0.1)}pre{padding:12px;margin:8px 0}blockquote{margin:8px 0;padding:8px 12px;border-left:4px solid #93c5fd;background:rgba(147,197,253,0.08);font-style:italic;color:#93c5fd}strong{color:#fb7185;font-weight:bold}em{color:#c4b5fd;font-style:italic}.dialogue,talk{color:#fda4af}a{color:#93c5fd}.tag-styled{white-space:inherit}</style></head><body><div id="content-wrapper">${sanitizedContent}</div></body></html>`;
}

export default memo(function ChatHtmlBubble({
  html: rawHtml,
  isLoading = false,
  isStreaming = false,
  onContentChange,
}: Props) {
  const { serifFontClass } = useLanguage();
  const contentRef = useRef<HTMLDivElement>(null);
  const detailsStateRef = useRef(new Map<number, boolean>());
  const onContentChangeRef = useRef(onContentChange);
  const isFullDoc = isCompleteHtmlDocument(rawHtml);
  const hasContent = rawHtml.trim() !== "";
  const initiallySanitizedHtml = hasContent
    ? sanitizeChatHtml(isStreaming ? rawHtml : (isFullDoc ? rawHtml : convertMarkdown(rawHtml)))
    : "";
  const formattedHtml = hasContent
    ? (isStreaming || isFullDoc
      ? initiallySanitizedHtml
      : replaceTags(initiallySanitizedHtml).replace(/^[\s\r\n]+|[\s\r\n]+$/g, ""))
    : "";
  const sanitizedHtml = hasContent
    ? (isStreaming || isFullDoc ? formattedHtml : sanitizeChatHtml(formattedHtml))
    : "";

  useLayoutEffect(() => {
    onContentChangeRef.current = onContentChange;
  }, [onContentChange]);

  useLayoutEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    // Streaming replaces the HTML subtree. Preserve each details element's
    // user-controlled state across those replacements instead of deriving it
    // from the latest response text.
    const state = detailsStateRef.current;
    const previousDetails = Array.from(container.querySelectorAll("details"));
    previousDetails.forEach((details, index) => state.set(index, details.open));

    container.innerHTML = sanitizedHtml;
    const listeners: Array<() => void> = [];
    Array.from(container.querySelectorAll("details")).forEach((details, index) => {
      if (state.has(index)) {
        details.open = state.get(index) === true;
      }
      const rememberToggle = () => state.set(index, details.open);
      details.addEventListener("toggle", rememberToggle);
      listeners.push(() => details.removeEventListener("toggle", rememberToggle));
    });
    onContentChangeRef.current?.();
    return () => listeners.forEach((remove) => remove());
  }, [sanitizedHtml]);

  if (!hasContent && isLoading) {
    return <div className="min-h-[12px]" aria-hidden="true" />;
  }

  if (!hasContent) {
    return (
      <div className="flex flex-col items-center justify-center py-6 px-4">
        <div className={`text-[15px] text-gray-400 font-medium leading-relaxed text-center ${serifFontClass}`}>
          No response received. Please check your network connection or API configuration.
        </div>
      </div>
    );
  }

  return (
    <div className="chat-bubble-container">
      <div
        ref={contentRef}
        className={`chat-html-content ${serifFontClass}`}
      />
    </div>
  );
});
