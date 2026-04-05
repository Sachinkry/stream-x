const manifestPath = "content/manifest.json";

const state = {
  allEntries: [],
  filteredEntries: [],
};

const streamElement = document.querySelector("#stream");
const statusElement = document.querySelector("#status-message");
const streamMetaElement = document.querySelector("#stream-meta");
const searchInput = document.querySelector("#search-input");
const entryTemplate = document.querySelector("#entry-template");

initialize().catch((error) => {
  console.error(error);
  setStatus("The archive could not be loaded.");
  streamMetaElement.textContent = "Check your content files and try again.";
});

async function initialize() {
  const files = await loadManifest();
  const documents = await Promise.all(files.map(loadMarkdownFile));
  const entries = documents.flatMap(({ source, markdown }) => parseEntries(markdown, source));

  entries.sort((left, right) => right.timestamp - left.timestamp);

  state.allEntries = entries;
  state.filteredEntries = entries;

  searchInput.addEventListener("input", handleSearch);

  renderEntries();
  updateMeta();
  setStatus("");
}

async function loadManifest() {
  const response = await fetch(manifestPath);

  if (!response.ok) {
    throw new Error(`Manifest request failed with ${response.status}`);
  }

  const manifest = await response.json();

  if (!Array.isArray(manifest.files)) {
    throw new Error("Manifest is missing a files array.");
  }

  return manifest.files;
}

async function loadMarkdownFile(source) {
  const response = await fetch(source);

  if (!response.ok) {
    throw new Error(`Failed to load ${source}`);
  }

  return {
    source,
    markdown: await response.text(),
  };
}

function parseEntries(markdown, source) {
  const trimmed = markdown.trim();

  if (!trimmed) {
    return [];
  }

  return trimmed
    .split(/\n={3,}\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk, index) => parseEntryChunk(chunk, source, index))
    .filter(Boolean);
}

function parseEntryChunk(chunk, source, index) {
  const normalized = chunk.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!match) {
    console.warn(`Skipped malformed entry ${index + 1} in ${source}`);
    return null;
  }

  const frontMatter = parseFrontMatter(match[1]);
  const body = match[2].trim();

  if (!frontMatter.date || !body) {
    console.warn(`Skipped incomplete entry ${index + 1} in ${source}`);
    return null;
  }

  const timestamp = new Date(frontMatter.date);

  if (Number.isNaN(timestamp.getTime())) {
    console.warn(`Skipped invalid date in ${source}: ${frontMatter.date}`);
    return null;
  }

  return {
    id: `${source}-${index}-${frontMatter.date}`,
    source,
    body,
    timestamp,
  };
}

function parseFrontMatter(frontMatterText) {
  const lines = frontMatterText.split("\n");
  const metadata = {};

  for (const line of lines) {
    const separatorIndex = line.indexOf(":");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    metadata[key] = value;
  }

  return metadata;
}

function handleSearch(event) {
  const query = event.target.value.trim().toLowerCase();

  if (!query) {
    state.filteredEntries = state.allEntries;
  } else {
    state.filteredEntries = state.allEntries.filter((entry) => {
      const dateLabel = formatDate(entry.timestamp).toLowerCase();
      const timeLabel = formatTime(entry.timestamp).toLowerCase();
      const haystack = `${entry.body} ${dateLabel} ${timeLabel}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  renderEntries();
  updateMeta();
}

function renderEntries() {
  streamElement.replaceChildren();

  if (!state.filteredEntries.length) {
    const emptyState = document.createElement("p");
    emptyState.className = "status-message";
    emptyState.textContent = "No entries match that search yet.";
    streamElement.append(emptyState);
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const entry of state.filteredEntries) {
    const node = entryTemplate.content.cloneNode(true);
    const article = node.querySelector(".entry-card");
    const dateElement = node.querySelector(".entry-card__date");
    const timeElement = node.querySelector(".entry-card__time");
    const bodyElement = node.querySelector(".entry-card__body");

    article.dataset.entryId = entry.id;
    dateElement.dateTime = entry.timestamp.toISOString();
    dateElement.textContent = formatDate(entry.timestamp);
    timeElement.textContent = formatTime(entry.timestamp);
    bodyElement.innerHTML = markdownToHtml(entry.body);

    fragment.append(node);
  }

  streamElement.append(fragment);
}

function updateMeta() {
  const total = state.allEntries.length;
  const visible = state.filteredEntries.length;

  if (!total) {
    streamMetaElement.textContent = "No entries published yet.";
    return;
  }

  if (visible === total) {
    streamMetaElement.textContent = `${total} ${total === 1 ? "entry" : "entries"} in the archive.`;
    return;
  }

  streamMetaElement.textContent = `Showing ${visible} of ${total} entries.`;
}

function setStatus(message) {
  statusElement.textContent = message;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatTime(date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function markdownToHtml(markdown) {
  const paragraphs = markdown
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return paragraphs
    .map((paragraph) => `<p>${renderInlineMarkdown(paragraph)}</p>`)
    .join("");
}

function renderInlineMarkdown(text) {
  return escapeHtml(text).replace(/\n/g, "<br />");
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
