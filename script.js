
const CENTER = [28.6139, 77.2090];
const STORAGE_KEY = "safecity-reports-v1";

const rules = [
  [/pothole|road damage|road crack/i, "Pothole or road damage"],
  [/streetlight|street light|lamp post/i, "Broken streetlight"],
  [/garbage|trash|waste|rubbish|bin/i, "Garbage overflow"],
  [/waterlogging|flood|standing water/i, "Waterlogging"],
  [/footpath|sidewalk|pavement/i, "Damaged footpath"],
  [/unsafe|dark area|safety concern/i, "Public safety concern"]
];

let reports = loadReports();
let selectedCoordinates = null;
let map;
let markerLayer;
let messageTimer;

const $ = id => document.getElementById(id);

function loadReports() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveReports() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
    return true;
  } catch {
    notify("Browser storage is full. Remove site data and try again.");
    return false;
  }
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function notify(text) {
  const box = $("message");
  box.textContent = text;
  box.classList.add("visible");
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => box.classList.remove("visible"), 3500);
}

map = L.map("map").setView(CENTER, 12);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

markerLayer = L.layerGroup().addTo(map);

function renderMap() {
  markerLayer.clearLayers();

  reports.forEach(report => {
    if (!Number.isFinite(Number(report.lat)) ||
        !Number.isFinite(Number(report.lng))) return;

    const marker = L.circleMarker([report.lat, report.lng], {
      radius: report.priority === "High" ? 8 : 6,
      color: "#ffffff",
      weight: 2,
      fillColor: report.status === "Resolved" ? "#176b4b" : "#17685d",
      fillOpacity: 1
    });

    marker.bindPopup(`
      <strong>${escapeHTML(report.category)}</strong>
      <p>${escapeHTML(report.location)}</p>
      <p>${escapeHTML(report.description)}</p>
      <small>Status: ${escapeHTML(report.status)}</small>
    `);

    marker.addTo(markerLayer);
  });
}

function renderReports() {
  $("total-count").textContent = reports.length;
  $("open-count").textContent =
    reports.filter(r => r.status === "Open").length;
  $("resolved-count").textContent =
    reports.filter(r => r.status === "Resolved").length;

  const filter = $("filter").value;
  const filtered = reports
    .filter(r => filter === "All" || r.status === filter)
    .sort((a, b) => b.createdAt - a.createdAt);

  $("reports-list").innerHTML = filtered.map(r => `
    <article class="report-row">
      <div>
        <h3 class="report-title">${escapeHTML(r.category)}</h3>
        <p class="report-detail">${escapeHTML(r.location)}</p>
        <p class="report-detail">${escapeHTML(r.description)}</p>
        <p class="report-detail">
          Priority: ${escapeHTML(r.priority)} · ${escapeHTML(formatDate(r.createdAt))}
        </p>
        ${r.reporter ? `<p class="report-detail">Name: ${escapeHTML(r.reporter)}</p>` : ""}
      </div>
      <div>
        <span class="report-status ${r.status}">${escapeHTML(r.status)}</span>
        <div class="report-actions">
          <button data-id="${escapeHTML(r.id)}">
            ${r.status === "Resolved" ? "Reopen report" : "Mark resolved"}
          </button>
        </div>
      </div>
    </article>
  `).join("");

  $("empty-state").hidden = filtered.length > 0;
  if (filtered.length === 0) {
    $("empty-state").textContent = reports.length
      ? "No reports match this filter."
      : "No reports have been saved in this browser yet.";
  }

  renderMap();
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(timestamp));
}

$("filter").addEventListener("change", renderReports);

$("reports-list").addEventListener("click", event => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;

  const report = reports.find(r => r.id === button.dataset.id);
  if (!report) return;

  report.status = report.status === "Resolved" ? "Open" : "Resolved";
  if (!saveReports()) return;

  renderReports();
  notify("Status updated in this browser only.");
});

$("reset-map").addEventListener("click", () => {
  map.setView(CENTER, 12);
});

$("photo").addEventListener("change", event => {
  const file = event.target.files[0];
  $("preview").hidden = true;

  if (!file) return;

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    event.target.value = "";
    notify("Choose a JPG, PNG or WEBP image.");
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    event.target.value = "";
    notify("Image must be smaller than 5 MB.");
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    $("preview").src = reader.result;
    $("preview").hidden = false;
  };
  reader.readAsDataURL(file);
});

$("suggest").addEventListener("click", () => {
  const file = $("photo").files[0];
  const text = `${file ? file.name : ""} ${$("description").value}`;

  const match = rules.find(([pattern]) => pattern.test(text));

  if (!match) {
    notify("No text match found. Select a category manually.");
    return;
  }

  $("category").value = match[1];
  $("suggest-note").textContent =
    "Text-based suggestion only. The image itself has not been analyzed.";
  notify("Suggested category: " + match[1]);
});

$("location").addEventListener("input", () => {
  selectedCoordinates = null;
});

$("use-location").addEventListener("click", () => {
  if (!navigator.geolocation) {
    notify("Location is not supported. Enter an address manually.");
    return;
  }

  $("location-note").textContent = "Requesting browser location permission.";

  navigator.geolocation.getCurrentPosition(async position => {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;

    selectedCoordinates = { lat, lng };
    $("location").value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    map.setView([lat, lng], 15);

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        if (data.display_name) $("location").value = data.display_name;
      }
    } catch {
      // Keep coordinates if address lookup fails.
    }

    $("location-note").textContent =
      "Location captured. Check the map and address before submitting.";
    notify("Location captured.");
  }, () => {
    $("location-note").textContent =
      "Location unavailable. Enter a nearby landmark manually.";
    notify("Location permission was denied or unavailable.");
  }, { enableHighAccuracy: true, timeout: 12000 });
});

async function findCoordinates(address) {
  const query = encodeURIComponent(address + ", New Delhi, India");
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=in&q=${query}`
  );

  if (!response.ok) throw new Error("Address lookup failed");

  const results = await response.json();
  if (!results.length) return null;

  return {
    lat: Number(results[0].lat),
    lng: Number(results[0].lon)
  };
}

$("report-form").addEventListener("submit", async event => {
  event.preventDefault();

  const category = $("category").value;
  const description = $("description").value.trim();
  const location = $("location").value.trim();

  if (!category || !description || !location) {
    notify("Complete the required fields.");
    return;
  }

  const submitButton = event.submitter;
  submitButton.disabled = true;
  submitButton.textContent = "Checking location...";

  try {
    const coords = selectedCoordinates || await findCoordinates(location);

    if (!coords) {
      notify("Location not found. Try a New Delhi landmark.");
      return;
    }

    const report = {
      id: "sc-" + Date.now(),
      category,
      description,
      location,
      priority: $("priority").value,
      reporter: $("reporter").value.trim(),
      status: "Open",
      lat: coords.lat,
      lng: coords.lng,
      createdAt: Date.now()
    };

    reports.unshift(report);

    if (!saveReports()) {
      reports.shift();
      return;
    }

    renderReports();
    map.setView([coords.lat, coords.lng], 14);

    event.target.reset();
    $("preview").hidden = true;
    $("preview").removeAttribute("src");
    selectedCoordinates = null;

    notify("Report saved locally and added to the map.");
  } catch {
    notify("Could not find the address. Check your connection.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Save report";
  }
});

renderReports();
