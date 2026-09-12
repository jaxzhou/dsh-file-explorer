window.__ModuleLoader__.load({ id: "@jaxzhou/dsh-file-explorer", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  FILES_VIEW_ID: () => FILES_VIEW_ID,
  RETAINED_PREVIEWS: () => RETAINED_PREVIEWS,
  apply: () => apply,
  extensionOf: () => extensionOf,
  hasSourceToggle: () => hasSourceToggle,
  inject: () => inject,
  name: () => name,
  parseJsonDocument: () => parseJsonDocument,
  previewFormatFor: () => previewFormatFor,
  previewLines: () => previewLines,
  tabLabels: () => tabLabels
});
module.exports = __toCommonJS(index_exports);

// src/client/FilesView.tsx
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/format.ts
var IMAGE_MEDIA_TYPES = /* @__PURE__ */ new Map([
  ["png", "image/png"],
  ["apng", "image/apng"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["jfif", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["avif", "image/avif"],
  ["bmp", "image/bmp"],
  ["ico", "image/x-icon"],
  // An SVG draws as an image here; `<img>` neither runs its scripts nor lets it
  // reach the application origin, so the markup stays inert.
  ["svg", "image/svg+xml"]
]);
var GRAMMAR_EXTENSIONS = {
  typescript: ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"],
  shellscript: ["sh", "bash", "zsh", "ksh", "shell"],
  json: ["json", "jsonc", "jsonl", "ndjson", "map", "webmanifest"],
  python: ["py", "pyw", "pyi"],
  ruby: ["rb", "rake", "gemspec", "ru"],
  go: ["go"],
  rust: ["rs"],
  java: ["java"],
  c: ["c", "h"],
  cpp: ["cc", "cpp", "cxx", "hh", "hpp", "hxx", "ipp"],
  csharp: ["cs", "csx"],
  kotlin: ["kt", "kts"],
  swift: ["swift"],
  php: ["php", "phtml", "php3", "php4", "php5"],
  yaml: ["yaml", "yml"],
  toml: ["toml"],
  ini: ["ini", "cfg", "conf", "properties", "desktop", "service"],
  markdown: ["md", "markdown", "mkd", "mdown", "mdwn"],
  mdx: ["mdx"],
  html: ["html", "htm", "xhtml", "shtml"],
  css: ["css"],
  scss: ["scss"],
  less: ["less"],
  sql: ["sql", "ddl", "dml"],
  xml: ["xml", "xsd", "xsl", "xslt", "rss", "atom", "plist"],
  lua: ["lua"]
};
var GRAMMAR_BY_EXTENSION = new Map(Object.entries(GRAMMAR_EXTENSIONS).flatMap(([grammar, suffixes]) => suffixes.map((suffix) => [suffix, grammar])));
function extensionOf(path) {
  const normalized = path.replaceAll("\\", "/");
  const name2 = normalized.slice(normalized.lastIndexOf("/") + 1);
  const at = name2.lastIndexOf(".");
  if (at <= 0 || at === name2.length - 1) return void 0;
  return name2.slice(at + 1).toLowerCase();
}
function previewFormatFor(path) {
  const extension = extensionOf(path);
  const mediaType = extension === void 0 ? void 0 : IMAGE_MEDIA_TYPES.get(extension);
  if (mediaType !== void 0) return { kind: "image", lang: void 0, mediaType };
  const lang = extension === void 0 ? void 0 : GRAMMAR_BY_EXTENSION.get(extension);
  if (lang === void 0) return { kind: "text", lang: void 0, mediaType: void 0 };
  if (lang === "json") return { kind: "json", lang, mediaType: void 0 };
  if (lang === "markdown") return { kind: "markdown", lang, mediaType: void 0 };
  return { kind: "code", lang, mediaType: void 0 };
}
function hasSourceToggle(format) {
  return format.kind === "markdown" || format.kind === "json";
}

// src/client/FilesView.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var byName = new Intl.Collator(void 0, { numeric: true, sensitivity: "base" });
function orderEntries(entries) {
  return [...entries].sort((left, right) => {
    const group = Number(right.type === "directory") - Number(left.type === "directory");
    return group !== 0 ? group : byName.compare(left.name, right.name);
  });
}
function childPath(parent, name2) {
  return `${parent.replace(/[/\\]+$/, "")}/${name2}`;
}
function pathParts(path) {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (at < 0) return { directory: "", name: path };
  return { directory: path.slice(0, at + 1), name: path.slice(at + 1) };
}
function tabLabels(open) {
  const twins = /* @__PURE__ */ new Map();
  for (const path of open) {
    const { name: name2 } = pathParts(path);
    twins.set(name2, (twins.get(name2) ?? 0) + 1);
  }
  const labels = {};
  for (const path of open) {
    const { directory, name: name2 } = pathParts(path);
    if ((twins.get(name2) ?? 0) < 2) {
      labels[path] = name2;
      continue;
    }
    const parent = pathParts(directory.replace(/[/\\]+$/, "")).name;
    labels[path] = parent === "" ? name2 : `${parent}/${name2}`;
  }
  return labels;
}
function previewLines(page) {
  return page.lines === 0 ? [] : page.text.split("\n");
}
function parseJsonDocument(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return void 0;
  }
  return typeof value === "object" && value !== null ? value : void 0;
}
function treeFailureLine(t, failure) {
  switch (failure.code) {
    case "workspace-file/not-found":
      return t("tree.error.notFound");
    case "workspace-file/outside-workspace":
      return t("tree.error.outsideWorkspace");
    case "workspace-file/not-directory":
      return t("tree.error.notDirectory");
    // Carrier and unclassified host failures reach the reader as themselves:
    // this tree knows nothing useful to add to a transport-level message.
    default:
      return t("tree.error.unavailable", { message: failure.message });
  }
}
function previewFailureLine(t, failure) {
  switch (failure.code) {
    case "workspace-file/not-found":
      return t("preview.error.notFound");
    case "workspace-file/not-text":
      return t("preview.error.notText");
    case "workspace-file/too-large":
      return t("preview.error.tooLarge");
    case "workspace-file/not-regular-file":
      return t("preview.error.notRegularFile");
    default:
      return t("preview.error.unavailable", { message: failure.message });
  }
}
function Level({ path, tree }) {
  const { state, t } = tree;
  const level = state.levels[path];
  if (level === void 0 || level.kind === "loading") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { className: "dsh-fe-note", "data-files-row": "loading", children: t("tree.loading") });
  }
  if (level.kind === "failed") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "li",
      {
        className: "dsh-fe-note dsh-fe-note-error",
        "data-files-row": "failed",
        "data-files-code": level.failure.code,
        children: treeFailureLine(t, level.failure)
      }
    );
  }
  const entries = orderEntries(level.level.entries);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    entries.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { className: "dsh-fe-note", "data-files-row": "empty", children: t("tree.empty") }),
    entries.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Entry, { parent: path, entry, tree }, entry.name)),
    level.level.truncated && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { className: "dsh-fe-note", "data-files-row": "truncated", children: t("tree.truncated") })
  ] });
}
function Entry({
  parent,
  entry,
  tree
}) {
  const path = childPath(parent, entry.name);
  if (entry.type === "directory") {
    const expanded = tree.state.expanded.includes(path);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { className: "dsh-fe-item", "data-files-entry": "directory", "data-files-path": path, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "button",
        {
          type: "button",
          className: "dsh-fe-row",
          "aria-expanded": expanded,
          onClick: () => {
            tree.onToggle(path);
          },
          children: [
            expanded ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconFolderOpen16, { className: "dsh-fe-icon" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconFolderClose16, { className: "dsh-fe-icon" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-fe-name", children: entry.name })
          ]
        }
      ),
      expanded && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "dsh-fe-level", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Level, { path, tree }) })
    ] });
  }
  if (entry.type === "file") {
    const isOpen = tree.open.has(path);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "li",
      {
        className: "dsh-fe-item",
        "data-files-entry": "file",
        "data-files-path": path,
        "data-files-open": isOpen || void 0,
        children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "button",
          {
            type: "button",
            className: "dsh-fe-row",
            "aria-current": tree.state.active === path,
            onClick: () => {
              tree.onOpen(path);
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.FileTypeIcon, { kind: (0, import_dsh_client_ui_primitives.classifyFileType)(entry.name), size: 16 }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-fe-name", children: entry.name }),
              isOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-fe-open-dot", "aria-hidden": "true" })
            ]
          }
        )
      }
    );
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { className: "dsh-fe-item", "data-files-entry": "other", "data-files-path": path, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-fe-row dsh-fe-row-static", title: tree.t("tree.other"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-fe-name", children: entry.name }) }) });
}
function HighlightedSource({
  page,
  lang,
  wrap,
  t
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-fe-source", "data-wrap": wrap, "data-preview-lang": lang ?? "plain", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_dsh_client_ui_primitives.CodeBlock,
    {
      code: page.text,
      lang,
      lineNumbers: true,
      copyLabel: t("code.copy"),
      copiedLabel: t("code.copied")
    }
  ) });
}
function FormattedBody({
  page,
  format,
  jsonDocument,
  t
}) {
  const copyLabel = t("code.copy");
  const copiedLabel = t("code.copied");
  const footnotes = t("footnotes");
  const markdownLabels = (0, import_react.useMemo)(
    () => ({ code: { copyLabel, copiedLabel }, footnotes }),
    [copyLabel, copiedLabel, footnotes]
  );
  const copyValue = t("json.copyValue");
  const copyJson = t("json.copyJson");
  const copyPath = t("json.copyPath");
  const copyPrettyJson = t("json.copyPrettyJson");
  const copyCompactJson = t("json.copyCompactJson");
  const copied = t("json.copied");
  const copyFailed = t("json.copyFailed");
  const collapseNode = t("json.collapseNode");
  const expandNode = t("json.expandNode");
  const jsonLabels = (0, import_react.useMemo)(() => ({
    copyValue,
    copyJson,
    copyPath,
    copyPrettyJson,
    copyCompactJson,
    copied,
    copyFailed,
    collapseNode,
    expandNode,
    // Reads the live translate at call time, so the tooltip follows a locale
    // change without rebuilding this object; `t` is stable by contract.
    copyButtonTitle: (action) => t("json.copyTitle", { action })
  }), [
    collapseNode,
    copyCompactJson,
    copyFailed,
    copyJson,
    copyPath,
    copyPrettyJson,
    copyValue,
    copied,
    expandNode,
    t
  ]);
  if (format.kind === "markdown") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-fe-prose", "data-preview-format": "markdown", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.MarkdownText, { text: page.text, labels: markdownLabels }) });
  }
  if (jsonDocument === void 0) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-fe-json", "data-preview-format": "json", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_dsh_client_ui_primitives.JsonTree,
    {
      data: jsonDocument,
      label: t("preview.jsonLabel"),
      labels: jsonLabels,
      expandTopLevel: false
    }
  ) });
}
function bodyKindOf(content, format, mode, jsonWalkable) {
  if (content !== null && content.kind === "image") return "image";
  if (!hasSourceToggle(format)) return "source";
  if ((mode ?? "rendered") === "source") return "source";
  if (format.kind === "json" && !jsonWalkable) return "source";
  return "rendered";
}
function PreviewBody({
  path,
  content,
  format,
  body,
  jsonDocument,
  jsonFallback,
  wrap,
  t
}) {
  if (content.kind === "image") {
    const { name: name2 } = pathParts(path);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-fe-scroll dsh-fe-imagehost", "data-preview-state": "ready", "data-preview-format": "image", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", { className: "dsh-fe-image", src: content.image.dataUrl, alt: name2, "data-preview-image": true }) });
  }
  const page = content.page;
  const lines = previewLines(page);
  if (lines.length === 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "div",
      {
        className: "dsh-fe-scroll",
        "data-preview-state": "ready",
        "data-preview-format": format.kind,
        "data-preview-lines": "0",
        children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-fe-note", "data-preview-row": "empty", children: t("preview.empty") })
      }
    );
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      className: "dsh-fe-scroll",
      "data-preview-state": "ready",
      "data-preview-format": format.kind,
      "data-preview-lines": lines.length,
      "data-preview-body": body,
      children: [
        jsonFallback && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-fe-note dsh-fe-note-error", "data-preview-row": "invalid-json", children: t("preview.jsonInvalid") }),
        body === "rendered" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FormattedBody, { page, format, jsonDocument, t }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HighlightedSource, { page, lang: format.lang, wrap, t }),
        !page.eof && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-fe-note", "data-preview-row": "truncated", children: t("preview.truncated", { lines: page.lines }) })
      ]
    }
  );
}
function FilesView({
  sessionId,
  useSessions,
  useStore,
  actions,
  list,
  read,
  t
}) {
  const cwd = useSessions((sessions) => sessions.byId[sessionId]?.cwd);
  const state = useStore((store) => store);
  const activeTabRef = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    if (cwd === void 0 || state.root === cwd) return;
    actions.start(cwd);
    list(cwd);
  }, [actions, cwd, list, state.root]);
  const active = state.active;
  const format = active === null ? null : previewFormatFor(active);
  const content = active !== null && state.previews[active]?.kind === "ready" ? state.previews[active].content : null;
  const jsonDocument = (0, import_react.useMemo)(() => {
    if (active === null || content === null || content.kind !== "text") return void 0;
    if ((state.modes[active] ?? "rendered") === "source") return void 0;
    if (previewFormatFor(active).kind !== "json") return void 0;
    return parseJsonDocument(content.page.text);
  }, [active, content, state.modes]);
  (0, import_react.useEffect)(() => {
    if (active === null) return;
    if (state.previews[active] !== void 0) return;
    read(active);
  }, [active, read, state.previews]);
  (0, import_react.useEffect)(() => {
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  if (cwd === void 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-fe-root", "data-files-state": "no-workspace", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-fe-status", children: t("tree.noWorkspace") }) });
  }
  if (state.root === null) return null;
  const openSet = new Set(state.open);
  const tree = {
    state,
    open: openSet,
    onToggle: (path) => {
      const loaded = state.levels[path] !== void 0;
      actions.toggled(path);
      if (!loaded) list(path);
    },
    onOpen: (path) => {
      actions.openFile(path);
    },
    t
  };
  const reloadTree = () => {
    actions.reset();
    for (const path of state.expanded) list(path);
  };
  const reloadPreview = () => {
    if (active !== null) read(active);
  };
  const closeTab = (path) => {
    actions.closeFile(path);
  };
  const root = pathParts(state.root);
  const labels = tabLabels(state.open);
  const wrap = active === null ? true : state.wraps[active] ?? true;
  const preview = active === null ? void 0 : state.previews[active];
  const body = bodyKindOf(content, format ?? { kind: "text", lang: void 0, mediaType: void 0 }, active === null ? void 0 : state.modes[active], jsonDocument !== void 0);
  const jsonFallback = format?.kind === "json" && (active === null ? "rendered" : state.modes[active] ?? "rendered") === "rendered" && jsonDocument === void 0 && content !== null && content.kind === "text";
  const meta = content === null ? null : content.kind === "text" ? [
    t("preview.lines", { lines: content.page.lines }),
    content.page.bytes === void 0 ? null : (0, import_dsh_client_ui_primitives.fileSizeText)(content.page.bytes)
  ].filter((part) => part !== null).join(" \xB7 ") : content.image.bytes === void 0 ? null : (0, import_dsh_client_ui_primitives.fileSizeText)(content.image.bytes);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "div",
    {
      className: "dsh-fe-root",
      "data-files-state": "tree",
      "data-files-root": state.root,
      "data-conversation-composer-overlay": "",
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-fe-panes", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-fe-tree", "data-files-pane": "tree", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-fe-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-fe-path", title: state.root, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-fe-path-muted", children: root.directory }),
              root.name
            ] }) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                className: "dsh-fe-tool",
                "aria-label": t("tree.reload"),
                title: t("tree.reload"),
                "data-files-reload": true,
                onClick: reloadTree,
                children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconRefreshOutline16, {})
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-fe-scroll", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "dsh-fe-level", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Level, { path: state.root, tree }) }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-fe-preview", "data-files-pane": "preview", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-fe-head dsh-fe-tabhead", children: [
            state.open.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-fe-path dsh-fe-path-muted", children: t("preview.title") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-fe-tabs", role: "tablist", "aria-label": t("preview.tabs"), "data-preview-tabs": true, children: state.open.map((path) => {
              const isActive = path === active;
              return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-fe-tab", role: "presentation", "data-preview-tab": path, "data-active": isActive || void 0, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                  "button",
                  {
                    type: "button",
                    role: "tab",
                    "aria-selected": isActive,
                    className: "dsh-fe-tab-label",
                    title: path,
                    ref: isActive ? activeTabRef : void 0,
                    "data-preview-tab-open": path,
                    onClick: () => {
                      actions.activate(path);
                    },
                    onAuxClick: (event) => {
                      if (event.button === 1) closeTab(path);
                    },
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.FileTypeIcon, { kind: (0, import_dsh_client_ui_primitives.classifyFileType)(path), size: 14 }),
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-fe-tab-name", children: labels[path] })
                    ]
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "button",
                  {
                    type: "button",
                    className: "dsh-fe-tab-close",
                    "aria-label": t("preview.close", { name: labels[path] }),
                    title: t("preview.close", { name: labels[path] }),
                    "data-preview-tab-close": path,
                    onClick: () => {
                      closeTab(path);
                    },
                    children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": "true", children: "\xD7" })
                  }
                )
              ] }, path);
            }) }),
            content !== null && meta !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-fe-meta", "data-preview-meta": true, children: meta }),
            active !== null && format !== null && hasSourceToggle(format) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                className: "dsh-fe-tool",
                "aria-pressed": body === "source",
                "aria-label": body === "source" ? t("preview.rendered") : t("preview.source"),
                title: body === "source" ? t("preview.rendered") : t("preview.source"),
                "data-preview-mode-toggle": true,
                onClick: () => {
                  actions.setMode(active, body === "source" ? "rendered" : "source");
                },
                children: body === "source" ? t("preview.rendered") : t("preview.source")
              }
            ),
            active !== null && body === "source" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                className: "dsh-fe-tool",
                "aria-pressed": wrap,
                "aria-label": wrap ? t("preview.nowrap") : t("preview.wrap"),
                title: wrap ? t("preview.nowrap") : t("preview.wrap"),
                "data-preview-wrap-toggle": true,
                onClick: () => {
                  actions.setWrap(active, !wrap);
                },
                children: wrap ? "\u21B5" : "\u2192"
              }
            ),
            active !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                className: "dsh-fe-tool",
                "aria-label": t("preview.reload"),
                title: t("preview.reload"),
                "data-preview-reload": true,
                onClick: reloadPreview,
                children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconRefreshOutline16, {})
              }
            )
          ] }),
          active === null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-fe-status", children: t("preview.placeholder") }),
          active !== null && (preview === void 0 || preview.kind === "loading") && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-fe-status", children: t("preview.loading") }),
          active !== null && preview?.kind === "failed" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-fe-scroll", "data-preview-state": "failed", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-fe-note dsh-fe-note-error", "data-preview-code": preview.failure.code, children: previewFailureLine(t, preview.failure) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsh-fe-tool", onClick: reloadPreview, children: t("preview.reload") })
          ] }),
          active !== null && content !== null && format !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            PreviewBody,
            {
              path: active,
              content,
              format,
              body,
              jsonDocument,
              jsonFallback,
              wrap,
              t
            }
          )
        ] })
      ] })
    }
  );
}

// src/client/face.ts
var PREVIEW_LINES = 2e3;
function filesFace(remote, sessionId, signal, actions) {
  const listingGenerations = /* @__PURE__ */ new Map();
  const readGenerations = /* @__PURE__ */ new Map();
  return {
    list(path) {
      if (signal.aborted) return;
      const generation = (listingGenerations.get(path) ?? 0) + 1;
      listingGenerations.set(path, generation);
      actions.loading(path);
      void remote.workspaceFiles.list(sessionId, path, signal).then((result) => {
        if (signal.aborted || listingGenerations.get(path) !== generation) return;
        if (result.ok) {
          actions.loaded(path, {
            entries: result.value.entries,
            truncated: result.value.truncated
          });
        } else {
          actions.failed(path, result.error);
        }
      });
    },
    read(path) {
      if (signal.aborted) return;
      const generation = (readGenerations.get(path) ?? 0) + 1;
      readGenerations.set(path, generation);
      const format = previewFormatFor(path);
      actions.reading(path);
      const settle = (write) => {
        if (signal.aborted || readGenerations.get(path) !== generation) return;
        write();
      };
      if (format.kind === "image") {
        void remote.workspaceFiles.readAll(sessionId, path, signal).then((result) => {
          settle(() => {
            if (result.ok) {
              actions.previewLoaded(path, {
                kind: "image",
                image: {
                  dataUrl: `data:${format.mediaType};base64,${result.value.data}`,
                  bytes: result.value.bytes
                }
              });
            } else {
              actions.previewFailed(path, result.error);
            }
          });
        });
        return;
      }
      void remote.workspaceFiles.read(sessionId, path, { offset: 1, limit: PREVIEW_LINES }, signal).then((result) => {
        settle(() => {
          if (result.ok) {
            const page = {
              text: result.value.text,
              lines: result.value.lines,
              eof: result.value.eof,
              bytes: result.value.bytes
            };
            actions.previewLoaded(path, { kind: "text", page });
          } else {
            actions.previewFailed(path, result.error);
          }
        });
      });
    }
  };
}

// src/client/locales.ts
var NS = "fileExplorer";
var zh = {
  "view.files": "\u6587\u4EF6",
  "tree.root": "\u5DE5\u4F5C\u533A",
  "tree.reload": "\u91CD\u65B0\u8BFB\u53D6",
  "tree.loading": "\u6B63\u5728\u8BFB\u53D6\u2026",
  "tree.empty": "\u7A7A\u76EE\u5F55",
  "tree.truncated": "\u6761\u76EE\u8FC7\u591A\uFF0C\u53EA\u663E\u793A\u4E86\u4E00\u90E8\u5206\u3002",
  "tree.noWorkspace": "\u8FD9\u4E2A\u4F1A\u8BDD\u6CA1\u6709\u5DE5\u4F5C\u533A\u76EE\u5F55\u3002",
  "tree.other": "\u65E2\u4E0D\u662F\u6587\u4EF6\u4E5F\u4E0D\u662F\u76EE\u5F55\uFF0C\u65E0\u6CD5\u6253\u5F00\u3002",
  "tree.error.notFound": "\u76EE\u5F55\u4E0D\u5B58\u5728\uFF0C\u53EF\u80FD\u5DF2\u88AB\u79FB\u52A8\u6216\u5220\u9664\u3002",
  "tree.error.outsideWorkspace": "\u8BE5\u76EE\u5F55\u5728\u5DE5\u4F5C\u533A\u4E4B\u5916\uFF0C\u65E0\u6CD5\u8BFB\u53D6\u3002",
  "tree.error.notDirectory": "\u8FD9\u4E0D\u662F\u4E00\u4E2A\u76EE\u5F55\u3002",
  "tree.error.unavailable": "\u8BFB\u53D6\u5931\u8D25\uFF1A{message}",
  "preview.placeholder": "\u4ECE\u5DE6\u4FA7\u9009\u62E9\u4E00\u4E2A\u6587\u4EF6\u8FDB\u884C\u9884\u89C8\u3002",
  "preview.empty": "\u7A7A\u6587\u4EF6",
  "preview.rendered": "\u9884\u89C8",
  "preview.source": "\u6E90\u7801",
  "preview.jsonLabel": "JSON \u6587\u6863",
  "preview.jsonInvalid": "\u8FD9\u4E0D\u662F\u53EF\u5C55\u5F00\u7684 JSON\uFF0C\u5DF2\u663E\u793A\u6E90\u7801\u3002",
  "code.copy": "\u590D\u5236",
  "code.copied": "\u5DF2\u590D\u5236",
  "footnotes": "\u811A\u6CE8",
  "json.copyValue": "\u590D\u5236\u503C",
  "json.copyJson": "\u590D\u5236 JSON",
  "json.copyPath": "\u590D\u5236\u8DEF\u5F84",
  "json.copyPrettyJson": "\u590D\u5236\u683C\u5F0F\u5316 JSON",
  "json.copyCompactJson": "\u590D\u5236\u538B\u7F29 JSON",
  "json.copied": "\u5DF2\u590D\u5236",
  "json.copyFailed": "\u590D\u5236\u5931\u8D25",
  "json.collapseNode": "\u6536\u8D77",
  "json.expandNode": "\u5C55\u5F00",
  "json.copyTitle": "{action}",
  "preview.title": "\u9884\u89C8",
  "preview.tabs": "\u6253\u5F00\u7684\u6587\u4EF6",
  "preview.close": "\u5173\u95ED {name}",
  "preview.loading": "\u6B63\u5728\u8BFB\u53D6\u2026",
  "preview.reload": "\u91CD\u65B0\u8BFB\u53D6",
  "preview.truncated": "\u6587\u4EF6\u8F83\u957F\uFF0C\u53EA\u663E\u793A\u524D {lines} \u884C\u3002",
  "preview.wrap": "\u81EA\u52A8\u6362\u884C",
  "preview.nowrap": "\u4E0D\u6362\u884C",
  "preview.lines": "{lines} \u884C",
  "preview.error.notFound": "\u6587\u4EF6\u4E0D\u5B58\u5728\uFF0C\u53EF\u80FD\u5DF2\u88AB\u79FB\u52A8\u6216\u5220\u9664\u3002",
  "preview.error.notText": "\u8FD9\u4E0D\u662F\u53EF\u4EE5\u9884\u89C8\u7684\u6587\u672C\u6587\u4EF6\u3002",
  "preview.error.tooLarge": "\u6587\u4EF6\u592A\u5927\uFF0C\u65E0\u6CD5\u9884\u89C8\u3002",
  "preview.error.notRegularFile": "\u8FD9\u4E0D\u662F\u4E00\u4E2A\u666E\u901A\u6587\u4EF6\u3002",
  "preview.error.unavailable": "\u9884\u89C8\u5931\u8D25\uFF1A{message}"
};
var en = {
  "view.files": "Files",
  "tree.root": "Workspace",
  "tree.reload": "Reload",
  "tree.loading": "Reading\u2026",
  "tree.empty": "Empty directory",
  "tree.truncated": "Too many entries, showing only some of them.",
  "tree.noWorkspace": "This session has no workspace directory.",
  "tree.other": "Not a file or a directory, so it cannot be opened.",
  "tree.error.notFound": "That directory is gone. It may have been moved or deleted.",
  "tree.error.outsideWorkspace": "That directory is outside the workspace, so it cannot be read.",
  "tree.error.notDirectory": "That is not a directory.",
  "tree.error.unavailable": "Read failed: {message}",
  "preview.placeholder": "Pick a file on the left to preview it.",
  "preview.empty": "Empty file",
  "preview.rendered": "Rendered",
  "preview.source": "Source",
  "preview.jsonLabel": "JSON document",
  "preview.jsonInvalid": "That is not JSON a tree can walk, so the source is shown.",
  "code.copy": "Copy",
  "code.copied": "Copied",
  "footnotes": "Footnotes",
  "json.copyValue": "Copy value",
  "json.copyJson": "Copy JSON",
  "json.copyPath": "Copy path",
  "json.copyPrettyJson": "Copy pretty JSON",
  "json.copyCompactJson": "Copy compact JSON",
  "json.copied": "Copied",
  "json.copyFailed": "Copy failed",
  "json.collapseNode": "Collapse",
  "json.expandNode": "Expand",
  "json.copyTitle": "{action}",
  "preview.title": "Preview",
  "preview.tabs": "Open files",
  "preview.close": "Close {name}",
  "preview.loading": "Reading\u2026",
  "preview.reload": "Reload",
  "preview.truncated": "This file is long, showing the first {lines} lines.",
  "preview.wrap": "Wrap long lines",
  "preview.nowrap": "Do not wrap long lines",
  "preview.lines": "{lines} lines",
  "preview.error.notFound": "That file is gone. It may have been moved or deleted.",
  "preview.error.notText": "That is not a text file this preview can show.",
  "preview.error.tooLarge": "That file is too large to preview.",
  "preview.error.notRegularFile": "That is not a regular file.",
  "preview.error.unavailable": "Preview failed: {message}"
};

// src/client/store.ts
var import_dsh_client_store = require("@deepseek-ai/dsh-client-store");
var RETAINED_PREVIEWS = 5;
function emptyState() {
  return {
    root: null,
    levels: {},
    expanded: [],
    open: [],
    active: null,
    previews: {},
    retained: [],
    modes: {},
    wraps: {}
  };
}
function retain(d, path) {
  d.retained = [path, ...d.retained.filter((candidate) => candidate !== path)];
  const keep = /* @__PURE__ */ new Set([...d.active === null ? [] : [d.active], ...d.retained.slice(0, RETAINED_PREVIEWS)]);
  for (const candidate of Object.keys(d.previews)) {
    if (!keep.has(candidate)) delete d.previews[candidate];
  }
  d.retained = d.retained.filter((candidate) => keep.has(candidate));
}
function createFilesStore() {
  return (0, import_dsh_client_store.defineStore)({
    init: emptyState,
    actions: {
      start: (d, root) => {
        Object.assign(d, emptyState());
        d.root = root;
        d.expanded = [root];
      },
      loading: (d, path) => {
        d.levels[path] = { kind: "loading" };
      },
      loaded: (d, path, level) => {
        d.levels[path] = { kind: "ready", level };
      },
      failed: (d, path, failure) => {
        d.levels[path] = { kind: "failed", failure };
      },
      toggled: (d, path) => {
        const at = d.expanded.indexOf(path);
        if (at >= 0) d.expanded.splice(at, 1);
        else d.expanded.push(path);
      },
      reset: (d) => {
        d.levels = {};
      },
      openFile: (d, path) => {
        if (!d.open.includes(path)) d.open.push(path);
        d.active = path;
      },
      activate: (d, path) => {
        if (!d.open.includes(path)) return;
        d.active = path;
        retain(d, path);
      },
      closeFile: (d, path) => {
        const at = d.open.indexOf(path);
        if (at < 0) return;
        d.open.splice(at, 1);
        delete d.previews[path];
        delete d.modes[path];
        delete d.wraps[path];
        d.retained = d.retained.filter((candidate) => candidate !== path);
        if (d.active !== path) return;
        d.active = d.open[at] ?? d.open[at - 1] ?? null;
      },
      reading: (d, path) => {
        if (!d.open.includes(path)) return;
        d.previews[path] = { kind: "loading" };
      },
      previewLoaded: (d, path, content) => {
        if (!d.open.includes(path)) return;
        d.previews[path] = { kind: "ready", content };
        retain(d, path);
      },
      previewFailed: (d, path, failure) => {
        if (!d.open.includes(path)) return;
        d.previews[path] = { kind: "failed", failure };
      },
      dropPreview: (d, path) => {
        delete d.previews[path];
        d.retained = d.retained.filter((candidate) => candidate !== path);
      },
      setWrap: (d, path, wrap) => {
        d.wraps[path] = wrap;
      },
      setMode: (d, path, mode) => {
        d.modes[path] = mode;
      }
    }
  });
}

// src/client/styles.ts
var STYLE_ATTRIBUTE = "data-dsh-file-explorer";
var CSS = `
.dsh-fe-root {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 1.5;
}

.dsh-fe-panes {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}

.dsh-fe-tree,
.dsh-fe-preview {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.dsh-fe-tree {
  flex: 0 0 auto;
  width: 280px;
  min-width: 160px;
  max-width: 60%;
  resize: horizontal;
  overflow: hidden;
  border-right: 0.5px solid var(--dsw-alias-border-l3);
}

.dsh-fe-preview {
  flex: 1 1 auto;
  min-width: 0;
}

.dsh-fe-head {
  display: flex;
  flex: 0 0 auto;
  gap: 4px;
  align-items: center;
  box-sizing: border-box;
  height: 38px;
  padding: 0 6px 0 14px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}

.dsh-fe-path {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}

.dsh-fe-path > span {
  direction: ltr;
  unicode-bidi: embed;
}

.dsh-fe-path-muted {
  color: var(--dsw-alias-label-tertiary);
}

.dsh-fe-meta {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  white-space: nowrap;
}

.dsh-fe-tool {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11px;
  line-height: 1;
  background: transparent;
  border: none;
  border-radius: 14px;
  cursor: pointer;
}

.dsh-fe-tool:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fe-tool svg {
  width: 15px;
  height: 15px;
}

.dsh-fe-scroll {
  flex: 1 1 auto;
  min-height: 0;
  padding: 8px 8px calc(var(--dsh-composer-height, 152px) + 24px);
  overflow: auto;
  scrollbar-gutter: stable;
}

.dsh-fe-scroll::-webkit-scrollbar-track {
  margin: 2px;
}

.dsh-fe-level {
  margin: 0;
  padding: 0;
  list-style: none;
}

.dsh-fe-level .dsh-fe-level {
  padding-left: 16px;
}

.dsh-fe-row {
  display: flex;
  gap: 6px;
  align-items: center;
  width: 100%;
  min-width: 0;
  padding: 5px 10px;
  color: inherit;
  font: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 10px;
  cursor: pointer;
}

.dsh-fe-row:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fe-row[aria-current='true'] {
  background: var(--dsw-alias-interactive-bg-active);
}

.dsh-fe-row-static {
  cursor: default;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-fe-row-static:hover {
  background: transparent;
}

.dsh-fe-icon {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-fe-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dsh-fe-note {
  margin: 0;
  padding: 3px 10px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
}

.dsh-fe-note-error {
  color: var(--dsw-alias-label-error);
}

.dsh-fe-status {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: var(--dsw-alias-label-secondary);
  text-align: center;
}

/* \u2500\u2500 format-aware bodies \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

/* Every body the pane can draw comes from the shared primitives, so this sheet
   carries no source-line rail of its own: the code block owns the numbered
   gutter, its counter, and its copy control. */

/* The shared CodeBlock draws the highlighted source; this host only swaps the
   chat card's chrome for the pane's: no margin, no radius, no grey fill, and
   the pane's own scroll container. */
.dsh-fe-source {
  --dsl-code-block-background: transparent;
  --dsl-code-block-border-radius: 0;
  --dsl-code-block-line-white-space: pre;
}

.dsh-fe-source .md-code-block {
  margin: 0;
}

.dsh-fe-source .md-code-block > [data-code-block-banner] > div:first-child:empty {
  display: none;
}

.dsh-fe-source .md-code-block pre {
  box-sizing: border-box;
  min-width: 100%;
  padding: 8px 0;
  overflow: visible;
  white-space: pre;
  word-break: normal;
  overflow-wrap: normal;
}

.dsh-fe-source[data-wrap='true'] {
  --dsl-code-block-line-white-space: pre-wrap;
}

.dsh-fe-source[data-wrap='true'] .md-code-block pre {
  white-space: pre-wrap;
  /* The primitive's default is break-all; keep words whole instead. */
  word-break: normal;
  overflow-wrap: break-word;
}

/* The preview pane's header row carries the open tabs and, at its end, the
   active tab's controls. The tabs take the room that is left and scroll; the
   controls never shrink away. */
.dsh-fe-tabhead {
  gap: 8px;
  padding: 0 6px 0 8px;
}

.dsh-fe-tabs {
  display: flex;
  flex: 1 1 auto;
  gap: 2px;
  align-items: stretch;
  min-width: 0;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.dsh-fe-tabs::-webkit-scrollbar {
  height: 0;
}

.dsh-fe-tab {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  min-width: 0;
  max-width: 220px;
  border-radius: 8px;
}

.dsh-fe-tab:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fe-tab[data-active] {
  background: var(--dsw-alias-interactive-bg-active);
}

.dsh-fe-tab-label {
  display: flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
  padding: 5px 4px 5px 8px;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  background: transparent;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}

.dsh-fe-tab[data-active] .dsh-fe-tab-label {
  color: var(--dsw-alias-label-primary);
}

.dsh-fe-tab-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* The close control appears for the tab under the pointer and for the active
   tab, so a full strip stays readable. */
.dsh-fe-tab-close {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-right: 5px;
  padding: 0;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 14px;
  line-height: 1;
  background: transparent;
  border: 0;
  border-radius: 5px;
  cursor: pointer;
  opacity: 0;
}

.dsh-fe-tab:hover .dsh-fe-tab-close,
.dsh-fe-tab[data-active] .dsh-fe-tab-close,
.dsh-fe-tab-close:focus-visible {
  opacity: 1;
}

.dsh-fe-tab-close:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

/* A file already open in a tab keeps a quiet marker in the tree, so the reader
   can see where the strip came from without it competing with the active row. */
.dsh-fe-open-dot {
  flex: 0 0 auto;
  width: 5px;
  height: 5px;
  margin-left: auto;
  background: var(--dsw-alias-brand-primary);
  border-radius: 50%;
  opacity: 0.6;
}

/* Rendered Markdown: prose lays out in normal white space, with the pane's
   insets and no monospace inheritance from the source view. */
.dsh-fe-prose {
  min-width: 0;
  padding: 4px 4px 0;
  font-family: var(--dsw-font-family);
  white-space: normal;
}

.dsh-fe-json {
  min-width: 0;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  white-space: normal;
}

/* An image keeps its intrinsic size, centres while it fits, and scales down to
   the pane rather than overflowing it. */
.dsh-fe-imagehost {
  display: flex;
  align-items: flex-start;
  justify-content: center;
}

.dsh-fe-image {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: 6px;
}
`;
function installStyles() {
  if (typeof document === "undefined") return () => {
  };
  if (document.querySelector(`style[${STYLE_ATTRIBUTE}]`) !== null) return () => {
  };
  const tag = document.createElement("style");
  tag.setAttribute(STYLE_ATTRIBUTE, "");
  tag.textContent = CSS;
  document.head.appendChild(tag);
  return () => {
    tag.remove();
  };
}

// src/client/index.ts
var name = "file-explorer";
var inject = ["slots", "locale", "remote", "remote.workspaceFiles"];
var FILES_VIEW_ID = "files";
function apply(ctx) {
  ctx.effect(installStyles, "@jaxzhou/dsh-file-explorer: stylesheet");
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "@jaxzhou/dsh-file-explorer: dictionaries");
  const t = ctx.locale.bind(NS);
  const store = createFilesStore();
  const lifetime = new AbortController();
  ctx.effect(() => () => {
    lifetime.abort();
  }, "@jaxzhou/dsh-file-explorer: request lifetime");
  ctx.slots.inject("conversation.view", () => ctx.slots.register({
    name: "conversation.view",
    id: FILES_VIEW_ID,
    // After Chat (default) and Trajectory (10), so the strip reads
    // Chat | Trajectory | Files.
    order: 20,
    locale: NS,
    label: () => t("view.files"),
    store,
    inject: (sessionId, actions) => filesFace(ctx.remote, sessionId, lifetime.signal, actions)
  }, FilesView));
}
return module.exports; } });
//# sourceMappingURL=client.js.map
