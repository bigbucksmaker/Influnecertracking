const DEFAULT_BASE = "https://www.virality.studio";
const input = document.getElementById("base");
const saved = document.getElementById("saved");

chrome.storage.sync.get({ baseUrl: DEFAULT_BASE }).then(({ baseUrl }) => {
  input.value = baseUrl;
});

document.getElementById("save").addEventListener("click", async () => {
  const value = (input.value || DEFAULT_BASE).trim().replace(/\/+$/, "");
  await chrome.storage.sync.set({ baseUrl: value || DEFAULT_BASE });
  saved.style.opacity = "1";
  setTimeout(() => (saved.style.opacity = "0"), 1500);
});
