import { highlight } from "@/lib/highlight";

/**
 * Renders code with VSCode Dark+-style token colors (see .code-theme css).
 * Server component: highlights during SSR so HTML carries the content.
 */
export function CodeBlock({ code, language, className = "" }: { code: string; language: string; className?: string }) {
  const tokens = highlight(code, language);
  const isPlain = language === "text" || language === "plaintext";

  return (
    <pre className={`code-block code-theme ${className}`}>
      {isPlain
        ? code
        : tokens.map((t, i) => (
            <span key={i} className={`tok-${t.type}`}>{t.text}</span>
          ))}
    </pre>
  );
}