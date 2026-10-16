
const STORAGE_KEY = "transiteye-complete-v2";
const DELHI = [28.6139, 77.2090];

const $ = id => document.getElementById(id);

let reports = loadReports();
let map;
let reportMarkers;
let selectedMarker = null;
let selectedCoordinates = null;
let selectedPhoto = "";
let noticeTimer;

function loadReports() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveReports() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
    return true;
  } catch {
    showNotice("Storage is full. Try using a smaller photo.");
    return false;
  }
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[ch]);
}

function showNotice(message) {
  const el = $("notice");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => el.classList.remove("show"), 3500);
}

function displayCoordinates(lat, lng) {
  $("map-latitude").textContent = Number(lat).toFixed(6);
  $("map-longitude").textContent = Number(lng).toFixed(6);
}

function selectPoint(lat, lng, zoom = true) {
  lat = Number(lat);
  lng = Number(lng);

  if (
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    lat < -90 || lat > 90 || lng < -180 || lng > 180
  ) {
    showNotice("The selected coordinates are invalid.");
    return;
  }

  selectedCoordinates = { lat, lng };
  displayCoordinates(lat, lng);

  if (!map) return;

  if (selectedMarker) {
    selectedMarker.setLatLng([lat, lng]);
  } else {
    selectedMarker = L.marker([lat, lng], {
      draggable: true,
      title: "Selected issue location"
    }).addTo(map);

    selectedMarker.on("dragend", () => {
      const p = selectedMarker.getLatLng();
      selectedCoordinates = { lat: p.lat, lng: p.lng };
      displayCoordinates(p.lat, p.lng);
      $("location-note").textContent =
        "Marker moved. Coordinates updated automatically.";
    });
  }

  selectedMarker.bindPopup(
    `Latitude: ${lat.toFixed(6)}<br>Longitude: ${lng.toFixed(6)}`
  );

  if (zoom) map.setView([lat, lng], 17);
}

function clearSelectedPoint() {
  selectedCoordinates = null;
  $("map-latitude").textContent = "Waiting for address";
  $("map-longitude").textContent = "Waiting for address";

  if (selectedMarker && map) {
    map.removeLayer(selectedMarker);
    selectedMarker = null;
  }
}

function initMap() {
  if (!window.L) {
    $("map").textContent =
      "Map unavailable. Check your internet connection.";
    return;
  }

  map = L.map("map").setView(DELHI, 12);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
  }).addTo(map);

  reportMarkers = L.layerGroup().addTo(map);

  map.on("click", event => {
    selectPoint(event.latlng.lat, event.latlng.lng, false);
    $("location-note").textContent =
      "Map point selected. Drag the marker to fine-tune it.";
  });

  renderReports();
}

async function searchAddress(address) {
  const params = new URLSearchParams({
    q: address,
    format: "jsonv2",
    limit: "5",
    countrycodes: "in",
    addressdetails: "1"
  });

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?${params.toString()}`
  );

  if (!response.ok) throw new Error("Address search failed.");

  const results = await response.json();

  if (!results.length) return null;

  const delhiResult = results.find(item =>
    /delhi|new delhi/i.test(item.display_name)
  );

  const result = delhiResult || results[0];

  return {
    lat: Number(result.lat),
    lng: Number(result.lon),
    name: result.display_name
  };
}

async function findAddress() {
  const address = $("location").value.trim();

  if (!address) {
    showNotice("Enter an address first.");
    $("location").focus();
    return;
  }

  const button = $("find-location");
  button.disabled = true;
  button.textContent = "Locating...";

  $("location-note").textContent = "Searching for your address...";

  try {
    const result = await searchAddress(address);

    if (!result) {
      clearSelectedPoint();
      $("location-note").textContent =
        "No matching address found. Try adding the street, area and city.";
      showNotice("Address not found.");
      return;
    }

    $("location").value = result.name;
    selectPoint(result.lat, result.lng);

    $("location-note").textContent =
      "Address located. Verify the pin. For an exact building or road point, click the map or drag the marker.";

    showNotice("Address located and coordinates filled automatically.");
  } catch {
    $("location-note").textContent =
      "Address search failed. Check your internet connection and try again.";
    showNotice("Could not search for this address.");
  } finally {
    button.disabled = false;
    button.textContent = "Find Address on Map";
  }
}

$("find-location").addEventListener("click", findAddress);

$("location").addEventListener("input", () => {
  clearSelectedPoint();
  $("location-note").textContent =
    "Click Find Address on Map after entering your address.";
});

$("reset-map").addEventListener("click", () => {
  if (map) map.setView(DELHI, 12);
});

function compressPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Photo read failed."));

    reader.onload = () => {
      const image = new Image();

      image.onerror = () => reject(new Error("Invalid image."));

      image.onload = () => {
        const scale = Math.min(
          1,
          1000 / Math.max(image.width, image.height)
        );

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Image processing failed."));
          return;
        }

        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.68));
      };

      image.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

$("photo").addEventListener("change", async event => {
  const file = event.target.files[0];
  const preview = $("photo-preview");

  selectedPhoto = "";
  preview.hidden = true;
  preview.removeAttribute("src");

  if (!file) return;

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    event.target.value = "";
    showNotice("Please select a JPG, PNG or WEBP image.");
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    event.target.value = "";
    showNotice("Choose a photo smaller than 5 MB.");
    return;
  }

  try {
    selectedPhoto = await compressPhoto(file);
    preview.src = selectedPhoto;
    preview.hidden = false;
    showNotice("Photo ready to attach to the report.");
  } catch {
    selectedPhoto = "";
    event.target.value = "";
    showNotice("Could not process the photo.");
  }
});

function renderReports() {
  $("total-count").textContent = reports.length;
  $("open-count").textContent =
    reports.filter(r => r.status === "Open").length;
  $("resolved-count").textContent =
    reports.filter(r => r.status === "Resolved").length;

  if (!reportMarkers) return;

  reportMarkers.clearLayers();

  reports.forEach(report => {
    const lat = Number(report.lat);
    const lng = Number(report.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const marker = L.circleMarker([lat, lng], {
      radius: 7,
      color: "#ffffff",
      weight: 2,
      fillColor: report.status === "Resolved" ? "#176b4b" : "#176c61",
      fillOpacity: 1
    });

    marker.bindPopup(`
      <strong>${escapeHTML(report.category)}</strong><br>
      ${escapeHTML(report.location)}<br>
      Lat: ${lat.toFixed(6)}<br>
      Long: ${lng.toFixed(6)}
      ${report.photo ? `<br><img src="${report.photo}" alt="Issue photo" style="width:180px;max-width:100%;margin-top:8px">` : ""}
    `);

    marker.addTo(reportMarkers);
  });

  const filter = $("status-filter").value;

  const filtered = reports
    .filter(r => filter === "All" || r.status === filter)
    .sort((a, b) => b.createdAt - a.createdAt);

  $("reports-list").innerHTML = filtered.map(report => {
    const lat = Number(report.lat).toFixed(6);
    const lng = Number(report.lng).toFixed(6);

    const mapURL =
      `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;

    return `
      <article class="report-card">
        <div>
          <h3>${escapeHTML(report.category)}</h3>
          <p><strong>Location:</strong> ${escapeHTML(report.location)}</p>
          <p><strong>Description:</strong> ${escapeHTML(report.description)}</p>
          <p><strong>Priority:</strong> ${escapeHTML(report.priority)}</p>
          <p><strong>Submitted:</strong> ${escapeHTML(new Date(report.createdAt).toLocaleString("en-IN"))}</p>
          ${report.reporter ? `<p><strong>Name:</strong> ${escapeHTML(report.reporter)}</p>` : ""}
          <div class="report-coordinates">
            Latitude: ${lat} &nbsp; | &nbsp; Longitude: ${lng}
          </div>
          <a class="report-map-link" href="${mapURL}" target="_blank" rel="noopener noreferrer">
            View exact coordinates on map
          </a>
          ${report.photo
            ? `<img class="report-photo" src="${report.photo}" alt="Photo evidence for ${escapeHTML(report.category)}" loading="lazy">`
            : `<p>No photo attached.</p>`}
        </div>

        <div>
          <span class="report-status ${report.status}">
            ${report.status}
          </span>
          <button class="report-action" type="button" data-id="${report.id}">
            ${report.status === "Open" ? "Mark resolved" : "Reopen report"}
          </button>
        </div>
      </article>
    `;
  }).join("");

  $("empty-state").hidden = filtered.length > 0;

  if (!filtered.length) {
    $("empty-state").textContent = reports.length
      ? "No reports match this filter."
      : "No reports submitted yet.";
  }
}

$("status-filter").addEventListener("change", renderReports);

$("reports-list").addEventListener("click", event => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;

  const report = reports.find(r => r.id === button.dataset.id);
  if (!report) return;

  const previousStatus = report.status;
  report.status = report.status === "Open" ? "Resolved" : "Open";

  if (!saveReports()) {
    report.status = previousStatus;
    return;
  }

  renderReports();
  showNotice("Report status updated.");
});

$("report-form").addEventListener("submit", event => {
  event.preventDefault();

  const category = $("category").value;
  const description = $("description").value.trim();
  const location = $("location").value.trim();

  if (!selectedCoordinates) {
    showNotice("Enter an address and click Find Address on Map first.");
    return;
  }

  if (!category || !description || !location) {
    showNotice("Complete all required fields.");
    return;
  }

  const report = {
    id: `report-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    category,
    description,
    location,
    priority: $("priority").value,
    reporter: $("reporter").value.trim(),
    status: "Open",
    lat: selectedCoordinates.lat,
    lng: selectedCoordinates.lng,
    photo: selectedPhoto,
    createdAt: Date.now()
  };

  reports.unshift(report);

  if (!saveReports()) {
    reports.shift();
    return;
  }

  renderReports();

  map.setView([report.lat, report.lng], 16);

  event.target.reset();
  selectedPhoto = "";
  $("photo-preview").hidden = true;
  $("photo-preview").removeAttribute("src");
  clearSelectedPoint();

  $("location-note").textContent =
    "Enter an address and click Find Address on Map.";

  showNotice("Report and photo saved successfully.");
});

initMap();
