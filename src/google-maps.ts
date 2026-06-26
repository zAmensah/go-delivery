import { GoogleMapsError } from "./errors.js";
import type {
  DistanceMatrixResult,
  FetchLike,
  LocationInput,
  LocationSearchResult,
  PlaceLocation
} from "./types.js";

const PLACES_AUTOCOMPLETE_URL =
  "https://maps.googleapis.com/maps/api/place/autocomplete/json";
const PLACE_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json";
const DISTANCE_MATRIX_URL =
  "https://maps.googleapis.com/maps/api/distancematrix/json";

interface GoogleAutocompleteResponse {
  status?: string;
  error_message?: string;
  predictions?: Array<{
    description?: string;
    place_id?: string;
  }>;
}

interface GooglePlaceDetailsResponse {
  status?: string;
  error_message?: string;
  result?: {
    formatted_address?: string;
    place_id?: string;
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
  };
}

interface GoogleDistanceMatrixResponse {
  status?: string;
  error_message?: string;
  rows?: Array<{
    elements?: Array<{
      status?: string;
      distance?: { value?: number };
      duration?: { value?: number };
    }>;
  }>;
}

export class GoogleMapsClient {
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;

  constructor(apiKey: string, fetchImpl: FetchLike) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  async searchLocations(query: string): Promise<LocationSearchResult[]> {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      return [];
    }

    const url = new URL(PLACES_AUTOCOMPLETE_URL);
    url.searchParams.set("input", trimmedQuery);
    url.searchParams.set("key", this.apiKey);

    const data = await this.getJson<GoogleAutocompleteResponse>(url);
    this.assertGoogleStatus(data.status, data.error_message, "Google Places Autocomplete");

    return (data.predictions ?? [])
      .filter((prediction) => prediction.description && prediction.place_id)
      .map((prediction) => ({
        description: prediction.description as string,
        placeId: prediction.place_id as string
      }));
  }

  async resolveLocation(placeId: string): Promise<PlaceLocation> {
    const trimmedPlaceId = placeId.trim();

    if (!trimmedPlaceId) {
      throw new GoogleMapsError("A Google place id is required.");
    }

    const url = new URL(PLACE_DETAILS_URL);
    url.searchParams.set("place_id", trimmedPlaceId);
    url.searchParams.set("fields", "formatted_address,geometry,place_id");
    url.searchParams.set("key", this.apiKey);

    const data = await this.getJson<GooglePlaceDetailsResponse>(url);
    this.assertGoogleStatus(data.status, data.error_message, "Google Place Details");

    const result = data.result;
    const coordinates = result?.geometry?.location;

    if (
      !result?.formatted_address ||
      typeof coordinates?.lat !== "number" ||
      typeof coordinates.lng !== "number"
    ) {
      throw new GoogleMapsError("Google Place Details returned an incomplete location.");
    }

    return {
      address: result.formatted_address,
      placeId: result.place_id ?? trimmedPlaceId,
      coordinates: {
        lat: coordinates.lat,
        lng: coordinates.lng
      }
    };
  }

  async distanceBetween(
    origin: PlaceLocation,
    destination: PlaceLocation
  ): Promise<DistanceMatrixResult> {
    const url = new URL(DISTANCE_MATRIX_URL);
    url.searchParams.set("origins", formatCoordinates(origin));
    url.searchParams.set("destinations", formatCoordinates(destination));
    url.searchParams.set("key", this.apiKey);

    const data = await this.getJson<GoogleDistanceMatrixResponse>(url);
    this.assertGoogleStatus(data.status, data.error_message, "Google Distance Matrix");

    const element = data.rows?.[0]?.elements?.[0];

    if (element?.status !== "OK" || typeof element.distance?.value !== "number") {
      throw new GoogleMapsError(
        `Google Distance Matrix could not calculate a route${
          element?.status ? `: ${element.status}` : "."
        }`
      );
    }

    return {
      distanceMeters: element.distance.value,
      durationSeconds: element.duration?.value
    };
  }

  private async getJson<T>(url: URL): Promise<T> {
    const response = await this.fetchImpl(url);

    if (!response.ok) {
      throw new GoogleMapsError(
        `Google Maps request failed with ${response.status} ${response.statusText}.`
      );
    }

    return (await response.json()) as T;
  }

  private assertGoogleStatus(
    status: string | undefined,
    errorMessage: string | undefined,
    service: string
  ): void {
    if (status && status !== "OK" && status !== "ZERO_RESULTS") {
      throw new GoogleMapsError(`${service} returned ${status}: ${errorMessage ?? "No details"}`);
    }
  }
}

export async function normalizeLocation(
  location: LocationInput,
  googleMaps: GoogleMapsClient
): Promise<PlaceLocation> {
  if (location.coordinates) {
    return {
      address: location.address ?? "",
      placeId: location.placeId,
      coordinates: location.coordinates
    };
  }

  if (location.placeId) {
    return googleMaps.resolveLocation(location.placeId);
  }

  throw new GoogleMapsError("Location must include either coordinates or a place id.");
}

function formatCoordinates(location: PlaceLocation): string {
  return `${location.coordinates.lat},${location.coordinates.lng}`;
}
