import type { ReactElement, ReactNode } from 'react';

const TOKEN_PATTERN =
  /(\/\/.*$|#.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b(?:export|import|from|const|let|var|return|function|if|else|interface|type|class|extends|async|await|new|public|private|protected|switch|case|default|for|while|try|catch|throw|true|false|null|undefined)\b|\b\d+\b)/gm;

function classifyToken(token: string): string {
  if (token.startsWith('//') || token.startsWith('#')) {
    return 'comment';
  }

  if (
    token.startsWith('"') ||
    token.startsWith("'") ||
    token.startsWith('`')
  ) {
    return 'string';
  }

  if (/^\d+$/.test(token)) {
    return 'number';
  }

  return 'keyword';
}

function highlightLine(line: string, lineIndex: number): ReactNode[] {
  const fragments: ReactNode[] = [];
  let lastIndex = 0;
  let tokenIndex = 0;

  for (const match of line.matchAll(TOKEN_PATTERN)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > lastIndex) {
      fragments.push(
        <span key={`plain-${lineIndex}-${tokenIndex}`}>
          {line.slice(lastIndex, start)}
        </span>,
      );
    }

    fragments.push(
      <span
        className={`code-token code-token-${classifyToken(token)}`}
        key={`token-${lineIndex}-${tokenIndex}`}
      >
        {token}
      </span>,
    );

    lastIndex = start + token.length;
    tokenIndex += 1;
  }

  if (lastIndex < line.length) {
    fragments.push(
      <span key={`tail-${lineIndex}`}>{line.slice(lastIndex)}</span>,
    );
  }

  return fragments;
}

interface CodeSyntaxPreviewProps {
  code: string;
}

export function CodeSyntaxPreview({ code }: CodeSyntaxPreviewProps): ReactElement {
  const lines = code.replace(/\r\n/g, '\n').split('\n').slice(0, 22);

  return (
    <div className="code-frame">
      {lines.map((line, index) => (
        <div className="code-line" key={`line-${index}`}>
          <span className="code-gutter">{String(index + 1).padStart(2, '0')}</span>
          <span className="code-content">
            {line.length === 0 ? <span>&nbsp;</span> : highlightLine(line, index)}
          </span>
        </div>
      ))}
    </div>
  );
}
