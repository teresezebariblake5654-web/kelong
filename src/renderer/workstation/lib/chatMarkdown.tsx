import type { ReactNode } from 'react';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(
      /`([^`]+)`/g,
      // Avoid theme `bg-muted` (dark navy under dark theme) on light bubbles — inherited
      // dark text on navy made Chinese backtick spans unreadable.
      '<code class="chat-md-code rounded px-1 py-0.5 font-mono text-[0.85em]">$1</code>',
    )
    .replace(/_(.+?)_/g, '<em>$1</em>');
}

function renderTableBlock(lines: string[]): ReactNode {
  const rows = lines
    .filter((line) => line.trim().startsWith('|'))
    .map((line) => line.split('|').map((cell) => cell.trim()).filter(Boolean));
  if (rows.length < 2) return null;
  const header = rows[0]!;
  const body = rows.slice(2);
  return (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {header.map((cell) => (
              <th key={cell} className="border border-border px-2 py-1 text-left">
                <span dangerouslySetInnerHTML={{ __html: renderInline(cell) }} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="border border-border px-2 py-1">
                  <span dangerouslySetInnerHTML={{ __html: renderInline(cell) }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function renderChatMarkdown(content: string): ReactNode {
  const blocks: ReactNode[] = [];
  const segments = content.split(/```([\s\S]*?)```/g);

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i] ?? '';
    if (i % 2 === 1) {
      blocks.push(
        <pre
          key={`code-${i}`}
          className="chat-md-pre my-2 overflow-x-auto rounded-[10px] px-3 py-2 font-mono text-xs"
        >
          <code>{segment.trim()}</code>
        </pre>,
      );
      continue;
    }

    const lines = segment.split('\n');
    let paragraph: string[] = [];
    let tableLines: string[] = [];

    const flushParagraph = () => {
      const text = paragraph.join('\n').trim();
      paragraph = [];
      if (!text) return;
      blocks.push(
        <p
          key={`p-${blocks.length}`}
          className="my-1 whitespace-pre-wrap leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderInline(text) }}
        />,
      );
    };

    const flushTable = () => {
      if (tableLines.length >= 2) {
        blocks.push(<div key={`table-${blocks.length}`}>{renderTableBlock(tableLines)}</div>);
      }
      tableLines = [];
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('|')) {
        flushParagraph();
        tableLines.push(trimmed.endsWith('|') ? trimmed : `${trimmed}|`);
        continue;
      }
      if (tableLines.length) flushTable();

      if (trimmed.startsWith('- ')) {
        flushParagraph();
        blocks.push(
          <li
            key={`li-${blocks.length}`}
            className="ml-4 list-disc"
            dangerouslySetInnerHTML={{ __html: renderInline(trimmed.slice(2)) }}
          />,
        );
        continue;
      }
      if (!trimmed) {
        flushParagraph();
        continue;
      }
      paragraph.push(line);
    }
    flushTable();
    flushParagraph();
  }

  return <div className="space-y-1">{blocks}</div>;
}
