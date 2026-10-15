
"use strict";

const $ = (id) => document.getElementById(id);

$("year").textContent = new Date().getFullYear();

// --------------------------------------------------
// MAP SETUP
// --------------------------------------------------

const map = L.map("map").setView([16.3067, 80.4365], 11);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

let startMarker = null;
let destinationMarker = null;
let selectedMarker = null;
let routeLayer = null;
let currentStart = null;
let currentDestination = null;

function setStatus(message) {
  $("status").textContent = message;
}

function addMarker(coords, label) {
  return L.marker(coords).addTo(map).bindPopup(label);
}

function clearRoute() {
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }

  [startMarker, destinationMarker].forEach(marker => {
    if (marker) map.removeLayer(marker);
  });

  startMarker = null;
  destinationMarker = null;
  $("distance").textContent = "—";
  $("duration").textContent = "—";
  $("directionsLink").hidden = true;
}

// --------------------------------------------------
// LOCATION SEARCH
// --------------------------------------------------

async function searchLocations(query) {
  if (!query.trim()) {
    throw new Error("Please enter a location.");
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "10");

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Location search is temporarily unavailable.");
  }

  return response.json();
}

function locationCategory(place) {
  const a = place.address || {};
  const type = `${place.type || ""} ${place.class || ""}`.toLowerCase();

  if (
    a.city || a.town || a.city_district ||
    ["city", "town", "suburb", "commercial", "residential"].some(
      term => type.includes(term)
    )
  ) {
    return "urban";
  }

  if (
    a.village || a.hamlet || a.farm || a.isolated_dwelling ||
    ["village", "hamlet", "farm", "rural"].some(
      term => type.includes(term)
    )
  ) {
    return "rural";
  }

  return "other";
}

function filterPlaces(places) {
  const filter = $("locationType").value;

  if (filter === "all") return places;

  return places.filter(place => locationCategory(place) === filter);
}

function showSearchResults(places) {
  const results = $("searchResults");
  results.replaceChildren();

  if (!places.length) {
    results.innerHTML =
      '<p class="empty-state">No matching locations found. Try another spelling or select Urban + Rural.</p>';
    return;
  }

  places.forEach(place => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "result-item";

    const name = document.createElement("strong");
    name.textContent = place.name ||
      place.display_name.split(",")[0];

    const detail = document.createElement("small");
    const category = locationCategory(place);
    detail.textContent =
      `${category === "other" ? "Location" : category.toUpperCase()} · ${place.display_name}`;

    button.append(name, detail);

    button.addEventListener("click", () => {
      const coords = [Number(place.lat), Number(place.lon)];

      map.setView(coords, 16);

      if (selectedMarker) map.removeLayer(selectedMarker);
      selectedMarker = addMarker(coords, place.display_name);
      selectedMarker.openPopup();

      $("weatherLocation").value = place.display_name;
      $("problemLocation").value = place.display_name;

      setStatus("Location selected: " + place.display_name);
      loadWeatherForPlace(place.display_name, coords[0], coords[1]);
    });

    results.appendChild(button);
  });
}

async function performPlaceSearch() {
  const query = $("placeSearch").value.trim();

  setStatus("Searching map locations...");
  $("searchResults").replaceChildren();

  try {
    const places = await searchLocations(query);
    const filtered = filterPlaces(places);

    showSearchResults(filtered);
    setStatus(`Found ${filtered.length} matching location(s).`);
  } catch (error) {
    setStatus(error.message);
  }
}

$("placeSearchBtn").addEventListener("click", performPlaceSearch);

$("placeSearch").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    performPlaceSearch();
  }
});

$("locationType").addEventListener("change", () => {
  if ($("placeSearch").value.trim()) performPlaceSearch();
});

// --------------------------------------------------
// ROUTE CALCULATION
// --------------------------------------------------

async function geocodeOne(query) {
  const places = await searchLocations(query);

  if (!places.length) {
    throw new Error(`Could not find "${query}". Try a more specific address.`);
  }

  const selected = places[0];

  return {
    lat: Number(selected.lat),
    lon: Number(selected.lon),
    name: selected.display_name
  };
}

async function calculateRoute(start, destination) {
  clearRoute();

  currentStart = start;
  currentDestination = destination;

  const startCoords = [start.lat, start.lon];
  const endCoords = [destination.lat, destination.lon];

  startMarker = addMarker(startCoords, "Start: " + start.name);
  destinationMarker = addMarker(endCoords, "Destination: " + destination.name);

  setStatus("Calculating driving route...");

  const url =
    "https://router.project-osrm.org/route/v1/driving/" +
    `${start.lon},${start.lat};${destination.lon},${destination.lat}` +
    "?overview=full&geometries=geojson";

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Route service is unavailable. Try again later.");
  }

  const data = await response.json();

  if (data.code !== "Ok" || !data.routes?.length) {
    throw new Error("No driving route was found between these locations.");
  }

  const route = data.routes[0];

  routeLayer = L.geoJSON(route.geometry, {
    style: {
      color: "#087a4b",
      weight: 6,
      opacity: 0.85
    }
  }).addTo(map);

  map.fitBounds(routeLayer.getBounds(), { padding: [30, 30] });

  $("distance").textContent =
    `${(route.distance / 1000).toFixed(1)} km`;

  const minutes = Math.round(route.duration / 60);
  $("duration").textContent =
    minutes >= 60
      ? `${Math.floor(minutes / 60)} hr ${minutes % 60} min`
      : `${minutes} min`;

  const directions = new URL("https://www.google.com/maps/dir/");
  directions.searchParams.set("api", "1");
  directions.searchParams.set("origin", `${start.lat},${start.lon}`);
  directions.searchParams.set(
    "destination",
    `${destination.lat},${destination.lon}`
  );
  directions.searchParams.set("travelmode", "driving");

  $("directionsLink").href = directions.toString();
  $("directionsLink").hidden = false;

  setStatus("Route calculated successfully.");
}

$("searchForm").addEventListener("submit", async event => {
  event.preventDefault();

  const startText = $("startLocation").value.trim();
  const destinationText = $("destination").value.trim();

  if (!destinationText) {
    setStatus("Please enter a destination.");
    return;
  }

  try {
    setStatus("Finding locations...");

    let start;

    if (startText) {
      start = await geocodeOne(startText);
    } else {
      start = {
        lat: 16.3067,
        lon: 80.4365,
        name: "Guntur, Andhra Pradesh (default start)"
      };
    }

    const destination = await geocodeOne(destinationText);

    await calculateRoute(start, destination);

    $("weatherLocation").value = destination.name;
    loadWeatherForPlace(
      destination.name,
      destination.lat,
      destination.lon
    );
  } catch (error) {
    setStatus(error.message);
  }
});

// --------------------------------------------------
// USER'S CURRENT LOCATION
// --------------------------------------------------

$("locateBtn").addEventListener("click", () => {
  if (!navigator.geolocation) {
    setStatus("Your browser does not support location access.");
    return;
  }

  setStatus("Requesting permission to access your location...");

  navigator.geolocation.getCurrentPosition(
    position => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      const coords = [lat, lon];

      map.setView(coords, 16);

      if (selectedMarker) map.removeLayer(selectedMarker);
      selectedMarker = addMarker(coords, "Your current location");
      selectedMarker.openPopup();

      $("startLocation").value = `${lat}, ${lon}`;
      $("problemLocation").value = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

      setStatus("Current location found. Enter your destination to route.");
    },
    error => {
      setStatus(
        error.code === 1
          ? "Location permission was denied. You can enter an address instead."
          : "Unable to get your location. Please enter an address manually."
      );
    },
    { enableHighAccuracy: true, timeout: 12000 }
  );
});

// --------------------------------------------------
// WEATHER
// --------------------------------------------------

const weatherDescriptions = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Rain showers",
  82: "Heavy rain showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Severe thunderstorm"
};

async function loadWeatherForPlace(name, lat, lon) {
  $("weatherResult").replaceChildren();

  const loading = document.createElement("p");
  loading.className = "muted";
  loading.textContent = "Loading weather...";
  $("weatherResult").appendChild(loading);

  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lon);
    url.searchParams.set(
      "current",
      "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m"
    );

    const response = await fetch(url);

    if (!response.ok) throw new Error("Weather service unavailable.");

    const data = await response.json();
    const current = data.current;

    const items = [
      ["Location", name],
      ["Conditions", weatherDescriptions[current.weather_code] || "Unknown"],
      ["Temperature", `${current.temperature_2m} °C`],
      ["Feels like", `${current.apparent_temperature} °C`],
      ["Humidity", `${current.relative_humidity_2m}%`],
      ["Wind speed", `${current.wind_speed_10m} km/h`],
      ["Precipitation", `${current.precipitation} mm`]
    ];

    const advice = document.createElement("p");
    advice.className = "empty-state full-width";

    if ([61, 63, 65, 80, 81, 82, 95, 96, 99].includes(current.weather_code)) {
      advice.textContent =
        "Travel advice: Rain or storm conditions may affect visibility and road safety. Check local warnings and drive carefully.";
    } else {
      advice.textContent =
        "Travel advice: Check local road conditions before travelling and follow traffic signs.";
    }

    $("weatherResult").replaceChildren();

    items.forEach(([label, value]) => {
      const card = document.createElement("div");
      card.className = "weather-item";

      const title = document.createElement("span");
      title.textContent = label;

      const content = document.createElement("strong");
      content.textContent = value;

      card.append(title, content);
      $("weatherResult").appendChild(card);
    });

    $("weatherResult").appendChild(advice);
  } catch (error) {
    $("weatherResult").replaceChildren();

    const message = document.createElement("p");
    message.className = "empty-state";
    message.textContent = error.message;
    $("weatherResult").appendChild(message);
  }
}

$("weatherForm").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    const place = await geocodeOne($("weatherLocation").value.trim());

    await loadWeatherForPlace(
      place.name,
      place.lat,
      place.lon
    );
  } catch (error) {
    $("weatherResult").textContent = error.message;
  }
});

// --------------------------------------------------
// REPORTS AND FEEDBACK STORAGE
// --------------------------------------------------

function readStorage(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeStorage(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch {
    alert("Browser storage is full or unavailable. Try a smaller photo.");
    return false;
  }
}

function makeFeedItem(title, description, date) {
  const article = document.createElement("article");
  article.className = "feed-item";

  const heading = document.createElement("strong");
  heading.textContent = title;

  const body = document.createElement("p");
  body.textContent = description;

  const timestamp = document.createElement("small");
  timestamp.textContent = new Date(date).toLocaleString();

  article.append(heading, body, timestamp);
  return article;
}

// --------------------------------------------------
// ROAD PROBLEM REPORTS
// --------------------------------------------------

function renderReports() {
  const list = $("reportsList");
  list.replaceChildren();

  const reports = readStorage("routesafe_reports");

  if (!reports.length) {
    list.innerHTML = '<p class="empty-state">No reports yet. Be the first to report a road problem.</p>';
    return;
  }

  reports.forEach(report => {
    const item = makeFeedItem(
      `${report.type} — ${report.location}`,
      report.description,
      report.date
    );

    if (report.photo) {
      const image = document.createElement("img");
      image.src = report.photo;
      image.alt = "Photo attached to road problem report";
      item.appendChild(image);
    }

    list.appendChild(item);
  });
}

$("reportForm").addEventListener("submit", async event => {
  event.preventDefault();

  const photoInput = $("problemPhoto");
  let photo = "";

  if (photoInput.files[0]) {
    const file = photoInput.files[0];

    if (!file.type.startsWith("image/")) {
      alert("Please choose an image file.");
      return;
    }

    if (file.size > 700 * 1024) {
      alert("Please use an image smaller than 700 KB.");
      return;
    }

    try {
      photo = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    } catch {
      alert("Could not read the selected photo.");
      return;
    }
  }

  const reports = readStorage("routesafe_reports");

  reports.unshift({
    type: $("problemType").value,
    location: $("problemLocation").value.trim(),
    description: $("problemDescription").value.trim(),
    photo,
    date: new Date().toISOString()
  });

  if (writeStorage("routesafe_reports", reports)) {
    $("reportForm").reset();
    renderReports();
    alert("Your report has been saved in this browser.");
  }
});

// --------------------------------------------------
// USER FEEDBACK
// --------------------------------------------------

function renderFeedback() {
  const list = $("feedbackList");
  list.replaceChildren();

  const feedback = readStorage("routesafe_feedback");

  if (!feedback.length) {
    list.innerHTML = '<p class="empty-state">No feedback yet. Share your experience with RouteSafe.</p>';
    return;
  }

  feedback.forEach(entry => {
    const item = document.createElement("article");
    item.className = "feed-item";

    const top = document.createElement("div");
    top.className = "feed-top";

    const name = document.createElement("strong");
    name.textContent = entry.name;

    const stars = document.createElement("span");
    stars.className = "stars";
    stars.textContent = "★".repeat(entry.rating) +
      "☆".repeat(5 - entry.rating);
    stars.setAttribute("aria-label", `${entry.rating} out of 5 stars`);

    top.append(name, stars);

    const message = document.createElement("p");
    message.textContent = entry.message;

    const date = document.createElement("small");
    date.textContent = new Date(entry.date).toLocaleString();

    item.append(top, message, date);
    list.appendChild(item);
  });
}

$("feedbackForm").addEventListener("submit", event => {
  event.preventDefault();

  const feedback = readStorage("routesafe_feedback");

  feedback.unshift({
    name: $("feedbackName").value.trim(),
    rating: Number($("feedbackRating").value),
    message: $("feedbackMessage").value.trim(),
    date: new Date().toISOString()
  });

  if (writeStorage("routesafe_feedback", feedback)) {
    $("feedbackForm").reset();
    renderFeedback();
    alert("Thank you! Your feedback has been saved.");
  }
});

// --------------------------------------------------
// INITIAL PAGE CONTENT
// --------------------------------------------------

renderReports();
renderFeedback();

// Wait until the page layout is ready before refreshing the map.
window.addEventListener("load", () => {
  map.invalidateSize();
});




