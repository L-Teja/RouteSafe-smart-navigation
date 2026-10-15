
const $ = id => document.getElementById(id);

const REPORTS_KEY = "routesafe_complete_reports_v1";
const FEEDBACK_KEY = "routesafe_complete_feedback_v1";

function readData(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveData(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function status(id, message, type = "") {
  const node = $(id);
  node.textContent = message;
  node.className = `status ${type}`.trim();
}

// -------------------------
// 1. INITIALIZE THE MAP
// -------------------------

const map = L.map("map").setView([16.3067, 80.4365], 11);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const problemTypes = {
  construction: {
    label: "Road construction",
    color: "#d58b27"
  },
  closure: {
    label: "Road closure",
    color: "#d64e4e"
  },
  flooding: {
    label: "Flooding / waterlogging",
    color: "#347bd1"
  },
  accident: {
    label: "Accident",
    color: "#9256b5"
  },
  pothole: {
    label: "Pothole / damaged road",
    color: "#657780"
  }
};

let selectedPoint = null;
let currentLocation = null;
let destination = null;
let routeLayer = null;
let startMarker = null;
let destinationMarker = null;

const reportLayers = [];

// -------------------------
// 2. DISPLAY ROAD REPORTS
// -------------------------

function drawReport(report) {
  if (
    !Number.isFinite(Number(report.lat)) ||
    !Number.isFinite(Number(report.lng))
  ) {
    return;
  }

  const type =
    problemTypes[report.type] || problemTypes.construction;

  const marker = L.circleMarker(
    [Number(report.lat), Number(report.lng)],
    {
      radius: 8,
      color: "#fff",
      weight: 2,
      fillColor: type.color,
      fillOpacity: 0.95
    }
  ).addTo(map);

  marker.bindPopup(`
    <strong>${escapeHTML(type.label)}</strong><br>
    ${escapeHTML(report.location)}<br>
    ${escapeHTML(report.details || "No additional details")}
  `);

  reportLayers.push(marker);
}

function renderReports() {
  const reports = readData(REPORTS_KEY);

  $("reportCount").textContent =
    `${reports.length} report${reports.length === 1 ? "" : "s"}`;

  $("reportList").innerHTML = reports.length
    ? reports.slice(0, 30).map(report => {
        const type =
          problemTypes[report.type] || problemTypes.construction;

        return `
          <article class="feed-item">
            <div class="feed-top">
              <h4>${escapeHTML(type.label)}</h4>
              <span class="tag">${escapeHTML(report.type)}</span>
            </div>
            <p><strong>${escapeHTML(report.location)}</strong></p>
            ${report.details
              ? `<p>${escapeHTML(report.details)}</p>`
              : ""}
            <small>
              ${escapeHTML(report.date || "")}
              ${report.lat != null ? " · map location attached" : ""}
            </small>
          </article>
        `;
      }).join("")
    : `<p class="small-note">
         No reports yet. Share the first road update.
       </p>`;
}

readData(REPORTS_KEY).forEach(drawReport);

// Click the map to select a report location.
map.on("click", event => {
  selectedPoint = {
    lat: event.latlng.lat,
    lng: event.latlng.lng
  };

  $("selectedMapPoint").textContent =
    `Map point selected: ${selectedPoint.lat.toFixed(5)}, ` +
    `${selectedPoint.lng.toFixed(5)}.`;

  status(
    "reportStatus",
    "Map location attached to the next report.",
    "success"
  );
});

// -------------------------
// 3. GET CURRENT GPS LOCATION
// -------------------------

$("currentLocationBtn").addEventListener("click", () => {
  if (!navigator.geolocation) {
    return status(
      "navigationStatus",
      "GPS is not supported by this browser.",
      "error"
    );
  }

  status("navigationStatus", "Getting your current location...");

  navigator.geolocation.getCurrentPosition(
    position => {
      currentLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
      };

      $("startLocation").value =
        `${currentLocation.lat.toFixed(6)}, ` +
        `${currentLocation.lng.toFixed(6)}`;

      map.setView(
        [currentLocation.lat, currentLocation.lng],
        15
      );

      if (startMarker) {
        map.removeLayer(startMarker);
      }

      startMarker = L.marker([
        currentLocation.lat,
        currentLocation.lng
      ])
        .addTo(map)
        .bindPopup("Your current location")
        .openPopup();

      status(
        "navigationStatus",
        "Location detected. Enter a destination and find your route.",
        "success"
      );
    },
    () => {
      status(
        "navigationStatus",
        "Could not get location. Allow location permission or enter a starting point manually.",
        "error"
      );
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    }
  );
});

// -------------------------
// 4. SEARCH FOR A PLACE
// -------------------------

async function geocode(query) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
    encodeURIComponent(query);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Place search service is unavailable.");
  }

  const results = await response.json();

  if (!results.length) {
    throw new Error(
      `Could not find "${query}". Try a more specific place.`
    );
  }

  return {
    lat: Number(results[0].lat),
    lng: Number(results[0].lon),
    name: results[0].display_name
  };
}

// -------------------------
// 5. FIND AND DRAW A ROUTE
// -------------------------

$("findRouteBtn").addEventListener("click", async () => {
  try {
    const startText = $("startLocation").value.trim();
    const destinationText =
      $("destinationInput").value.trim();

    if (!startText) {
      throw new Error(
        "Click Use my current location or enter a starting point."
      );
    }

    if (!destinationText) {
      throw new Error("Enter your destination.");
    }

    status("navigationStatus", "Finding your route...");
    $("navigationDetails").innerHTML = "";
    $("startNavigationBtn").hidden = true;

    // Accept either typed coordinates or a place name.
    const coords = startText.match(
      /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/
    );

    const start = coords
      ? {
          lat: Number(coords[1]),
          lng: Number(coords[2]),
          name: "Starting point"
        }
      : await geocode(startText);

    currentLocation = {
      lat: start.lat,
      lng: start.lng
    };

    destination = await geocode(destinationText);

    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${start.lng},${start.lat};` +
      `${destination.lng},${destination.lat}` +
      `?overview=full&geometries=geojson`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        "Routing service is unavailable. Try again later."
      );
    }

    const result = await response.json();

    if (result.code !== "Ok" || !result.routes?.length) {
      throw new Error("No driving route found for these locations.");
    }

    const route = result.routes[0];

    // Remove old route and endpoint markers.
    if (routeLayer) map.removeLayer(routeLayer);
    if (startMarker) map.removeLayer(startMarker);
    if (destinationMarker) map.removeLayer(destinationMarker);

    // Draw the route.
    routeLayer = L.geoJSON(route.geometry, {
      style: {
        color: "#087f70",
        weight: 6,
        opacity: 0.9
      }
    }).addTo(map);

    startMarker = L.marker([start.lat, start.lng])
      .addTo(map)
      .bindPopup("Starting point");

    destinationMarker = L.marker([
      destination.lat,
      destination.lng
    ])
      .addTo(map)
      .bindPopup("Destination");

    map.fitBounds(routeLayer.getBounds(), {
      padding: [30, 30]
    });

    const km = (route.distance / 1000).toFixed(1);
    const totalMinutes = Math.round(route.duration / 60);

    const duration = totalMinutes >= 60
      ? `${Math.floor(totalMinutes / 60)} hr ${totalMinutes % 60} min`
      : `${totalMinutes} min`;

    $("navigationDetails").innerHTML = `
      <div class="route-stat">
        <strong>${km} km</strong> · approximately
        <strong>${duration}</strong>
        <p class="small-note">
          Estimated time from the demo routing service;
          live traffic may change it.
        </p>
      </div>
      <p class="small-note">
        <strong>To:</strong> ${escapeHTML(destinationText)}
      </p>
    `;

    $("startNavigationBtn").hidden = false;

    status(
      "navigationStatus",
      "Route found and displayed on the map.",
      "success"
    );
  } catch (error) {
    status(
      "navigationStatus",
      error.message || "Unable to find route.",
      "error"
    );
  }
});

// Open turn-by-turn navigation in Google Maps.
$("startNavigationBtn").addEventListener("click", () => {
  if (!currentLocation || !destination) {
    return status(
      "navigationStatus",
      "Find a route first.",
      "error"
    );
  }

  const url =
    "https://www.google.com/maps/dir/?api=1" +
    `&origin=${currentLocation.lat},${currentLocation.lng}` +
    `&destination=${destination.lat},${destination.lng}` +
    "&travelmode=driving&dir_action=navigate";

  window.open(url, "_blank", "noopener,noreferrer");
});

// -------------------------
// 6. REPORT A ROAD PROBLEM
// -------------------------

$("reportForm").addEventListener("submit", event => {
  event.preventDefault();

  const location = $("roadLocation").value.trim();

  if (!location) {
    return status(
      "reportStatus",
      "Enter a road or area.",
      "error"
    );
  }

  const report = {
    id: Date.now(),
    location,
    type: $("problemType").value,
    details: $("problemDetails").value.trim(),
    date: new Date().toLocaleString(),
    ...(selectedPoint || {})
  };

  const reports = readData(REPORTS_KEY);
  reports.unshift(report);

  if (!saveData(REPORTS_KEY, reports)) {
    return status(
      "reportStatus",
      "Unable to save this report in browser storage.",
      "error"
    );
  }

  drawReport(report);
  renderReports();

  $("reportForm").reset();
  selectedPoint = null;

  $("selectedMapPoint").textContent =
    "Optional: click the map to attach coordinates to this report.";

  status(
    "reportStatus",
    "Road report saved on this device. It is not shared with other users.",
    "success"
  );

  $("precautionType").value = report.type;
  renderPrecautions();
});

// -------------------------
// 7. LOAD CURRENT WEATHER
// -------------------------

const weatherCodes = {
  0: ["Clear sky", "☀️"],
  1: ["Mainly clear", "🌤️"],
  2: ["Partly cloudy", "⛅"],
  3: ["Overcast", "☁️"],
  45: ["Fog", "🌫️"],
  48: ["Fog", "🌫️"],
  51: ["Light drizzle", "🌦️"],
  53: ["Drizzle", "🌦️"],
  55: ["Heavy drizzle", "🌧️"],
  61: ["Light rain", "🌦️"],
  63: ["Moderate rain", "🌧️"],
  65: ["Heavy rain", "🌧️"],
  71: ["Light snow", "🌨️"],
  73: ["Snow", "🌨️"],
  75: ["Heavy snow", "❄️"],
  80: ["Rain showers", "🌦️"],
  81: ["Rain showers", "🌧️"],
  82: ["Heavy showers", "⛈️"],
  95: ["Thunderstorm", "⛈️"],
  96: ["Thunderstorm with hail", "⛈️"],
  99: ["Severe thunderstorm", "⛈️"]
};

async function loadWeather(city) {
  $("weatherResult").innerHTML =
    "<p>Loading current weather…</p>";

  try {
    const geoResponse = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en`
    );

    if (!geoResponse.ok) {
      throw new Error("Weather location search is unavailable.");
    }

    const geoData = await geoResponse.json();

    if (!geoData.results?.length) {
      throw new Error("City not found. Try another name.");
    }

    const place = geoData.results[0];

    const url =
      `https://api.open-meteo.com/v1/forecast?` +
      `latitude=${place.latitude}` +
      `&longitude=${place.longitude}` +
      `&current=temperature_2m,relative_humidity_2m,` +
      `apparent_temperature,precipitation,weather_code,wind_speed_10m` +
      `&timezone=auto`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Weather service is unavailable.");
    }

    const data = await response.json();
    const c = data.current;

    const [description, icon] =
      weatherCodes[c.weather_code] ||
      ["Conditions unavailable", "🌡️"];

    const wetCodes = [
      51, 53, 55, 61, 63, 65, 80, 81, 82
    ];

    const stormCodes = [95, 96, 99];
    const fogCodes = [45, 48];

    let warning =
      "Check official local alerts before leaving and stay alert to changing conditions.";

    if (wetCodes.includes(c.weather_code)) {
      warning =
        "Wet roads may reduce grip and increase braking distance. Slow down, increase following distance, and never drive through floodwater.";

      $("precautionWeather").value = "rain";
    } else if (stormCodes.includes(c.weather_code)) {
      warning =
        "Thunderstorms can create dangerous travel conditions. Seek safe shelter if conditions worsen and follow official alerts.";

      $("precautionWeather").value = "storm";
    } else if (fogCodes.includes(c.weather_code)) {
      warning =
        "Visibility may be low. Slow down, use low-beam headlights, and pull off the road safely if visibility becomes dangerous.";

      $("precautionWeather").value = "fog";
    } else {
      $("precautionWeather").value = "clear";
    }

    $("weatherResult").innerHTML = `
      <div class="weather-main">
        <div>
          <h3>
            ${escapeHTML(place.name)},
            ${escapeHTML(place.country || "")}
          </h3>
          <div class="weather-temp">
            ${Math.round(c.temperature_2m)}°C
          </div>
          <div class="weather-desc">
            ${icon} ${escapeHTML(description)} · feels like
            ${Math.round(c.apparent_temperature)}°C
          </div>
        </div>
        <div class="weather-icon">${icon}</div>
      </div>

      <div class="weather-stats">
        <div class="weather-stat">
          <span>Humidity</span>
          <strong>${c.relative_humidity_2m}%</strong>
        </div>
        <div class="weather-stat">
          <span>Wind speed</span>
          <strong>${c.wind_speed_10m} km/h</strong>
        </div>
        <div class="weather-stat">
          <span>Precipitation</span>
          <strong>${c.precipitation} mm</strong>
        </div>
      </div>

      <div class="weather-warning">${escapeHTML(warning)}</div>
      <p class="small-note">
        Updated: ${escapeHTML(String(c.time).replace("T", " "))}
        local time.
      </p>
    `;

    renderPrecautions();
  } catch (error) {
    $("weatherResult").innerHTML = `
      <p class="status error">
        ${escapeHTML(error.message || "Unable to load weather.")}
      </p>
    `;
  }
}

$("weatherForm").addEventListener("submit", event => {
  event.preventDefault();

  const city = $("weatherCity").value.trim();

  if (city) loadWeather(city);
});

// -------------------------
// 8. SAFETY PRECAUTIONS
// -------------------------

const roadAdvice = {
  normal: [
    "Normal road conditions",
    [
      "Follow speed limits and traffic signals.",
      "Wear a seat belt or helmet and avoid phone use while driving."
    ]
  ],
  construction: [
    "Road construction",
    [
      "Slow down and follow temporary signs and authorized diversions.",
      "Keep extra distance from workers and other vehicles; never cross barriers."
    ]
  ],
  closure: [
    "Road closure",
    [
      "Never pass barricades or enter a closed road.",
      "Use an open route confirmed by official signs or reliable navigation."
    ]
  ],
  flooding: [
    "Flooding / waterlogging",
    [
      "Never drive or walk through floodwater; depth and current can be deceptive.",
      "Turn around and choose a safe alternative route; follow local emergency advice."
    ]
  ],
  accident: [
    "Accident nearby",
    [
      "Slow down safely and avoid crowding the incident.",
      "Keep lanes clear for emergency responders; call local emergency services if needed."
    ]
  ],
  pothole: [
    "Potholes / damaged road",
    [
      "Reduce speed and scan ahead for damaged surfaces.",
      "Avoid sudden swerving; change lanes only when it is safe."
    ]
  ]
};

const weatherAdvice = {
  clear: [
    "Clear / normal weather",
    [
      "Stay alert, hydrated, and rested on long trips.",
      "Check your vehicle and route before departure."
    ]
  ],
  rain: [
    "Rain",
    [
      "Reduce speed and increase following distance on wet roads.",
      "Use headlights when visibility is reduced; never drive through floodwater."
    ]
  ],
  storm: [
    "Thunderstorm / strong wind",
    [
      "If conditions become unsafe, stop at a safe sheltered location away from trees and flood-prone areas.",
      "Follow official weather alerts and wait for conditions to improve."
    ]
  ],
  fog: [
    "Fog",
    [
      "Slow down and leave a larger gap between vehicles.",
      "Use low-beam headlights; pull completely off the roadway at a safe place if visibility becomes dangerously poor."
    ]
  ],
  heat: [
    "Extreme heat",
    [
      "Carry water and take breaks in a cool place.",
      "Never leave children or pets in a parked vehicle; stop safely if your vehicle overheats."
    ]
  ]
};

function adviceCard(item, warning = false) {
  return `
    <article class="precaution-card ${warning ? "warning" : ""}">
      <h3>${warning ? "⚠ " : "✓ "}${escapeHTML(item[0])}</h3>
      <ul>
        ${item[1].map(text =>
          `<li>${escapeHTML(text)}</li>`
        ).join("")}
      </ul>
    </article>
  `;
}

function renderPrecautions() {
  const roadKey = $("precautionType").value;
  const weatherKey = $("precautionWeather").value;

  $("precautionResult").innerHTML =
    adviceCard(
      roadAdvice[roadKey] || roadAdvice.normal,
      ["closure", "flooding", "accident"].includes(roadKey)
    ) +
    adviceCard(
      weatherAdvice[weatherKey] || weatherAdvice.clear,
      ["rain", "storm", "fog", "heat"].includes(weatherKey)
    );
}

$("precautionForm").addEventListener("submit", event => {
  event.preventDefault();
  renderPrecautions();
});

$("problemType").addEventListener("change", () => {
  $("precautionType").value = $("problemType").value;
  renderPrecautions();
});

// -------------------------
// 9. FEEDBACK SUBMISSION
// -------------------------

function renderFeedback() {
  const items = readData(FEEDBACK_KEY);

  $("feedbackCount").textContent =
    `${items.length} entr${items.length === 1 ? "y" : "ies"}`;

  $("feedbackList").innerHTML = items.length
    ? items.slice(0, 40).map(item => {
        const rating = Math.max(
          1,
          Math.min(5, Number(item.rating) || 5)
        );

        return `
          <article class="feed-item">
            <div class="feed-top">
              <h4>${escapeHTML(item.name || "Anonymous traveler")}</h4>
              <span class="stars" aria-label="${rating} out of 5 stars">
                ${"★".repeat(rating)}${"☆".repeat(5 - rating)}
              </span>
            </div>
            <p>${escapeHTML(item.text)}</p>
            <small>${escapeHTML(item.date || "")}</small>
          </article>
        `;
      }).join("")
    : `<p class="small-note">
         No feedback yet. Your feedback will appear here after submission.
       </p>`;
}

$("feedbackForm").addEventListener("submit", event => {
  event.preventDefault();

  const text = $("feedbackText").value.trim();

  if (text.length < 3) {
    return status(
      "feedbackStatus",
      "Please enter at least 3 characters.",
      "error"
    );
  }

  const items = readData(FEEDBACK_KEY);

  items.unshift({
    name: $("feedbackName").value.trim(),
    rating: Number($("feedbackRating").value),
    text,
    date: new Date().toLocaleString()
  });

  if (!saveData(FEEDBACK_KEY, items)) {
    return status(
      "feedbackStatus",
      "Could not save feedback in this browser.",
      "error"
    );
  }

  $("feedbackForm").reset();
  renderFeedback();

  status(
    "feedbackStatus",
    "Thank you! Your feedback is saved and displayed below.",
    "success"
  );
});

// -------------------------
// 10. START THE APPLICATION
// -------------------------

renderReports();
renderFeedback();
renderPrecautions();
loadWeather($("weatherCity").value.trim());

