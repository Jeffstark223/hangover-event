const fs = require('fs');
const path = require('path');

const DEFAULT_LOCATION_FILE = path.join(__dirname, '..', 'config', 'event-location.json');

// Optional: EVENT_LOCATION_FILE can point at a different JSON file (used by the
// automated tests). Normally leave it unset and edit config/event-location.json.
const locationFile = () =>
  process.env.EVENT_LOCATION_FILE ? path.resolve(process.env.EVENT_LOCATION_FILE) : DEFAULT_LOCATION_FILE;
const DEFAULT_MESSAGE = 'Venue details coming soon.';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const httpsUrl = (v) => (/^https:\/\/\S+$/i.test(str(v)) ? str(v) : '');

function readRaw() {
  try {
    return JSON.parse(fs.readFileSync(locationFile(), 'utf8'));
  } catch (err) {
    // Missing or invalid file must never show a wrong venue: fall back to "coming soon".
    return { confirmed: false };
  }
}

/**
 * Returns the event location exactly as it should be shown to the public.
 * Read fresh on every call so edits to config/event-location.json apply
 * immediately. Never invents an address or coordinates.
 */
function getLocation() {
  const raw = readRaw();
  const message = str(raw.comingSoonMessage) || DEFAULT_MESSAGE;
  const venueName = str(raw.venueName);
  const address = str(raw.address);
  const displayText = [venueName, address].filter(Boolean).join(', ');

  if (raw.confirmed !== true || !displayText) {
    return {
      confirmed: false,
      message,
      venueName: '',
      address: '',
      displayText: message,
      directionsUrl: null,
      embedUrl: null,
      mapNote: '',
    };
  }

  // The written venue (displayText) and the map pin are deliberately separate:
  // the pin searches `mapQuery` (e.g. the landmark itself), not the venue text.
  const mapQuery = str(raw.mapQuery) || displayText;
  return {
    confirmed: true,
    message: '',
    venueName: venueName || address,
    address: venueName ? address : '',
    displayText,
    directionsUrl:
      httpsUrl(raw.directionsUrl) || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`,
    embedUrl: httpsUrl(raw.embedUrl) || `https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`,
    mapNote: str(raw.mapNote),
  };
}

/** One line for PDFs / emails: the venue, or the "coming soon" message. */
function getLocationText() {
  return getLocation().displayText;
}

module.exports = { getLocation, getLocationText, locationFile };
