import { marked } from "marked";

marked.setOptions({
  breaks: true,
  gfm: true,
});

export function md(text: string): string {
  const html = marked.parse(text, { async: false }) as string;
  return html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
}
