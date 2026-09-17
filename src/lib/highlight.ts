/**
 * Tiny regex tokenizer for syntax highlighting — no dependency, no WASM.
 * Emits VSCode Dark+ style classes (`tok-*`) so themes decide color.
 * Coverage: the languages offered in the paste composer.
 */

export type HighlightToken = { type: string; text: string };

type LangConfig = {
  /** line/block comment delimiters */
  line: string[];
  block?: [string, string];
  /** language keyword set */
  keywords: Set<string>;
  template?: boolean; // backtick template literals (js/ts)
  shebang?: boolean;  // #!/... first line (bash, python, etc.)
  markup?: boolean;   // html-ish tags and attributes
};

const JS_TS = new Set([
  "break","case","catch","class","const","continue","debugger","default","delete","do","else","enum","export","extends","false","finally","for","function","if","import","in","instanceof","new","null","return","super","switch","this","throw","true","try","typeof","var","void","while","with","as","async","await","yield","let","static","get","set","of","interface","type","namespace","declare","public","private","protected","readonly","implements","abstract","satisfies","keyof","unknown","never","any","string","number","boolean","object","undefined","symbol","bigint","is","out","infer","global"
]);

// shared keywords subset used by c-family, go, rust, java
const C_LIKE = new Set([
  "auto","break","case","char","const","continue","default","do","double","else","enum","extern","false","float","for","goto","if","inline","int","long","return","short","signed","sizeof","static","struct","switch","true","typedef","union","unsigned","void","volatile","while","class","public","private","protected","virtual","friend","namespace","template","typename","this","new","delete","try","catch","throw","using","nullptr","final","override"
]);

const GO = new Set([
  "break","case","chan","const","continue","default","defer","else","fallthrough","for","func","go","goto","if","import","interface","map","package","range","return","select","struct","switch","type","var","nil","true","false","string","int","bool","error","byte","rune","float64"
]);

const RUST = new Set([
  "as","async","await","break","const","continue","crate","dyn","else","enum","extern","false","fn","for","if","impl","in","let","loop","match","mod","move","mut","pub","ref","return","self","Self","static","struct","super","trait","true","type","unsafe","use","where","while","String","Option","Result","Vec","Box","Some","None","Ok","Err"
]);

const PY = new Set([
  "and","as","assert","async","await","break","class","continue","def","del","elif","else","except","False","finally","for","from","global","if","import","in","is","lambda","None","nonlocal","not","or","pass","raise","return","True","try","while","with","yield","self","print","len","range","type","match","case"
]);

const JAVA = new Set([
  "abstract","assert","boolean","break","byte","case","catch","char","class","const","continue","default","do","double","else","enum","extends","final","finally","float","for","goto","if","implements","import","instanceof","int","interface","long","native","new","package","private","protected","public","return","short","static","strictfp","super","switch","synchronized","this","throw","throws","transient","try","void","volatile","while","var","true","false","null","String","Integer","System","void"
]);

const C = new Set(C_LIKE);
const CPP = new Set([...C_LIKE, "using","namespace"]);
const SQL = new Set([
  "select","from","where","insert","into","values","update","set","delete","create","table","alter","drop","index","view","join","left","right","inner","outer","on","group","by","order","limit","offset","having","and","or","not","null","is","in","like","between","as","distinct","case","when","then","else","end","primary","key","foreign","references","int","varchar","text","boolean","date","timestamp","default","unique","constraint"
]);

const BASH = new Set([
  "if","then","else","elif","fi","for","while","until","do","done","case","esac","function","in","select","time","coproc","return","break","continue","exit","export","local","readonly","declare","set","unset","shift","source","exec","trap","echo","printf","cd","pwd","ls","mkdir","rm","cp","mv","grep","sed","awk","cat"
]);

const MARKDOWN = new Set([]);

const CONFIGS: Record<string, LangConfig> = {
  javascript: { line: ["//"], block: ["/*","*/"], template: true, keywords: JS_TS },
  typescript: { line: ["//"], block: ["/*","*/"], template: true, keywords: JS_TS },
  python: { line: ["#"], keywords: PY },
  go: { line: ["//"], block: ["/*","*/"], keywords: GO },
  rust: { line: ["//"], block: ["/*","*/"], keywords: RUST },
  c: { line: ["//"], block: ["/*","*/"], keywords: C },
  cpp: { line: ["//"], block: ["/*","*/"], keywords: CPP },
  java: { line: ["//"], block: ["/*","*/"], keywords: JAVA },
  json: { line: [], keywords: new Set(["true","false","null"]) },
  html: { line: [], keywords: new Set([]), markup: true },
  css: { line: [], block: ["/*","*/"], keywords: new Set(["important","inherit","initial","unset","none","auto","solid","dashed","dotted","hidden","visible","flex","block","inline","grid"]) },
  sql: { line: ["--"], block: ["/*","*/"], keywords: SQL },
  bash: { line: ["#"], shebang: true, keywords: BASH },
  markdown: { line: [], keywords: MARKDOWN },
  text: { line: [], keywords: new Set() },
  plaintext: { line: [], keywords: new Set() },
};

const DEFAULT: LangConfig = { line: ["//", "#"], block: ["/*","*/"], keywords: new Set() };

export function languageConfig(lang: string): LangConfig {
  return CONFIGS[lang.toLowerCase()] ?? DEFAULT;
}

const IDENT = "[A-Za-z_$][A-Za-z0-9_$]*";
const STRING_RE = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/y;
const TEMPLATE_RE = /`(?:[^`\\]|\\.)*`/y;
const NUMBER_RE = /\b(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/y;

function buildPattern(config: LangConfig): { re: RegExp; map: string[] } {
  const groups: string[] = [];
  const names: string[] = [];

  const add = (name: string, src: string) => { groups.push(`(${src})`); names.push(name); };

  if (config.shebang) add("comment", /^#![^\n]*/.source);
  const lineAlt = config.line.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[^\\n]*").join("|");
  if (lineAlt) add("comment", lineAlt);
  if (config.block) {
    const b = config.block.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*?");
    add("comment", `${config.block[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${config.block[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    void b;
  }
  if (config.template) add("string", "`(?:[^`\\\\]|\\\\.)*`");
  add("string", `"(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'`);
  add("number", NUMBER_RE.source);

  if (config.keywords.size) {
    const kw = [...config.keywords].sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    add("keyword", `\\b(?:${kw})\\b`);
  }
  add("function", `${IDENT}(?=\\s*\\()`);
  add("type", `\\b\\(?:[A-Z][A-Za-z0-9_]*\\)\\b`);
  if (config.markup) {
    add("tag", `<\\/?\\b[A-Za-z][A-Za-z0-9-]*`);
    add("attr", `[A-Za-z-]+(?==)`);
    add("punct", `[<>\\/]`);
  }
  add("ident", IDENT);
  add("op", "[+\\-*/%=<>!&|^~?:]+");
  add("punct", "[(){}\\[\\].,;]");
  add("ws", "\\s+");

  return { re: new RegExp(groups.join("|"), "y"), map: names };
}

const PATTERN_CACHE = new Map<string, { re: RegExp; map: string[] }>();

export function highlight(code: string, lang: string): HighlightToken[] {
  const config = languageConfig(lang);
  let key = lang.toLowerCase();
  if (!PATTERN_CACHE.has(key)) PATTERN_CACHE.set(key, buildPattern(config));
  const { re, map } = PATTERN_CACHE.get(key)!;
  // markdown gets a special lightweight pass
  if (lang.toLowerCase() === "markdown") return highlightMarkdown(code);

  const tokens: HighlightToken[] = [];
  let pos = 0;
  re.lastIndex = 0;
  const m = re.exec(code);
  void m;
  while (pos < code.length) {
    re.lastIndex = pos;
    const match = re.exec(code);
    if (!match) {
      tokens.push({ type: "plain", text: code.slice(pos) });
      break;
    }
    if (match.index > pos) {
      tokens.push({ type: "plain", text: code.slice(pos, match.index) });
    }
    const gi = match.findIndex((v, i) => i > 0 && v !== undefined);
    tokens.push({ type: map[gi - 1] ?? "plain", text: match[0] });
    pos = match.index + match[0].length;
  }
  return tokens;
}

/** markdown: headings, code fences, bold/italic, links, lists */
function highlightMarkdown(code: string): HighlightToken[] {
  const parts: HighlightToken[] = [];
  const lines = code.split(/\n/);
  for (const line of lines) {
    const fence = /^(`{3,}|~{3,})/.exec(line);
    if (fence) { parts.push({ type: "punct", text: line + "\n" }); continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      parts.push({ type: "keyword", text: heading[1] + " " });
      parts.push({ type: "title", text: heading[2] + "\n" });
      continue;
    }
    const list = /^(\s*[-*+]\s|\s*\d+\.\s)/.exec(line);
    if (list) { parts.push({ type: "punct", text: list[1] }); parts.push({ type: "plain", text: line.slice(list[1].length) + "\n" }); continue; }
    const link = /\[([^\]]*)\]\(([^)]*)\)/y;
    link.lastIndex = 0;
    let out = "";
    let pos = 0;
    let lm: RegExpExecArray | null;
    link.lastIndex = pos;
    while ((lm = link.exec(line.slice(pos)))) {
      const fullIdx = pos + lm.index;
      // rebuild manual scan below is overkill; simple fallback: bold/italic inline
      void fullIdx;
      out += line.slice(pos, pos + lm.index);
      out += lm[0];
      pos += lm.index + lm[0].length;
      link.lastIndex = 0;
    }
    void out;
    // simpler inline pass: bold **x**, italic *x*, code `x`
    const inline = line.replace(/(\*\*|__)(.*?)\1/g, "**$2**");
    const inline2 = inline.replace(/(`)([^`]*)\1/g, "$1$2$1");
    void inline2;
    const bold = /\*\*(.+?)\*\*|__(.+?)__/g;
    let bm;
    let bpos = 0;
    while ((bm = bold.exec(line))) {
      if (bm.index > bpos) parts.push({ type: "plain", text: line.slice(bpos, bm.index) });
      parts.push({ type: "title", text: bm[0] });
      bpos = bm.index + bm[0].length;
    }
    if (bpos < line.length) parts.push({ type: "plain", text: line.slice(bpos) });
    parts.push({ type: "plain", text: "\n" });
  }
  return parts.filter((t) => t.text.length);
}