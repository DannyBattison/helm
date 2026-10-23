import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

(self as any).MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  }
};

const rules = (c: Record<string, string>) => [
  { token: 'comment', foreground: c.comment, fontStyle: 'italic' }, { token: 'keyword', foreground: c.keyword }, { token: 'string', foreground: c.string },
  { token: 'number', foreground: c.number }, { token: 'type', foreground: c.type }, { token: 'type.identifier', foreground: c.type }, { token: 'identifier', foreground: c.variable },
  { token: 'delimiter', foreground: c.punct }, { token: 'tag', foreground: c.tag }, { token: 'attribute.name', foreground: c.fn }, { token: 'attribute.value', foreground: c.string }
];

/** Ported from the design handoff (CodeView.jsx `defineThemes`). */
function defineThemes(m: typeof monaco) {
  m.editor.defineTheme('helm-dark', {
    base: 'vs-dark', inherit: true,
    rules: rules({ comment: '6b6b7a', keyword: 'c4a7ff', string: '9ad48a', number: 'f2b866', type: '6fd6c8', variable: 'e4e4ec', punct: '8e8e9c', tag: 'ff9b8f', fn: '7cc4ff' }),
    colors: {
      'editor.background': '#09090c', 'editor.foreground': '#e4e4ec', 'editorLineNumber.foreground': '#3c3c47', 'editorLineNumber.activeForeground': '#9d9dab',
      'editor.lineHighlightBackground': '#131318', 'editor.lineHighlightBorder': '#00000000', 'editor.selectionBackground': '#a78bfa40', 'editorCursor.foreground': '#a78bfa',
      'editorIndentGuide.background1': '#1e1e25', 'editorIndentGuide.activeBackground1': '#3c3c47', 'editorGutter.background': '#09090c', 'minimap.background': '#09090c',
      'scrollbarSlider.background': '#3a3a4566', 'scrollbarSlider.hoverBackground': '#3a3a45aa', 'editorWidget.background': '#18181e', 'editorWidget.border': '#2a2a33',
      'editorBracketMatch.border': '#a78bfa80', 'editorBracketMatch.background': '#00000000'
    }
  });
  m.editor.defineTheme('helm-light', {
    base: 'vs', inherit: true,
    rules: rules({ comment: '8a8a96', keyword: '7c3aed', string: '2f7d32', number: 'b45309', type: '00796b', variable: '1f1f28', punct: '6b6b77', tag: 'c62828', fn: '1565c0' }),
    colors: {
      'editor.background': '#ffffff', 'editor.foreground': '#1f1f28', 'editorLineNumber.foreground': '#c9c9d3', 'editorLineNumber.activeForeground': '#55555f',
      'editor.lineHighlightBackground': '#f6f6f8', 'editor.lineHighlightBorder': '#00000000', 'editor.selectionBackground': '#7655d930', 'editorCursor.foreground': '#7655d9',
      'editorIndentGuide.background1': '#ebebf0', 'editorGutter.background': '#ffffff', 'minimap.background': '#ffffff', 'editorWidget.background': '#ffffff', 'editorWidget.border': '#dedee5'
    }
  });
}

defineThemes(monaco);
// Diagnostics need a project config the worktree doesn't give the worker, so they are off (see handoff).
monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true });
monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true });
monaco.languages.typescript.typescriptDefaults.setCompilerOptions({ jsx: monaco.languages.typescript.JsxEmit.Preserve, allowNonTsExtensions: true, target: monaco.languages.typescript.ScriptTarget.ESNext });

export const themeName = (t: 'dark' | 'light') => (t === 'light' ? 'helm-light' : 'helm-dark');
export { monaco };
