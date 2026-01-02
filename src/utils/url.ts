/**
 * Normalize and resolve Google Maps URLs
 */

export function normalizeGoogleMapsUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    
    // Remove tracking parameters
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'gid', 'cid'];
    trackingParams.forEach(param => urlObj.searchParams.delete(param));
    
    // Normalize /maps/place/ paths
    let pathname = urlObj.pathname;
    
    // Remove locale segments (/en/, /de/, etc.)
    pathname = pathname.replace(/^\/([a-z]{2}(?:-[A-Z]{2})?)\//, '/');
    
    // Normalize /maps/place/... format
    if (pathname.startsWith('/maps/place/')) {
      // Extract place name and place_id
      const match = pathname.match(/^\/maps\/place\/([^/]+)(?:\/([^/]+))?/);
      if (match) {
        const placeName = match[1];
        const placeId = match[2];
        if (placeId) {
          pathname = `/maps/place/${placeName}/${placeId}`;
        } else {
          pathname = `/maps/place/${placeName}`;
        }
      }
    }
    
    urlObj.pathname = pathname;
    
    // Remove zoom and view-only parameters
    urlObj.searchParams.delete('zoom');
    urlObj.searchParams.delete('hl');
    
    return urlObj.toString();
  } catch (e) {
    return url;
  }
}

export function extractPlaceId(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const match = urlObj.pathname.match(/\/maps\/place\/[^/]+\/([^/?]+)/);
    if (match) {
      return match[1];
    }
    
    // Also check data parameter
    const dataParam = urlObj.searchParams.get('data');
    if (dataParam) {
      const dataMatch = dataParam.match(/!3d[^!]*!4d[^!]*!16s([^!]+)/);
      if (dataMatch) {
        return dataMatch[1];
      }
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

export function extractCid(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const cid = urlObj.searchParams.get('cid');
    if (cid) {
      return cid;
    }
    
    // Check data parameter
    const dataParam = urlObj.searchParams.get('data');
    if (dataParam) {
      const cidMatch = dataParam.match(/cid[=:]([^&!]+)/);
      if (cidMatch) {
        return cidMatch[1];
      }
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

export function deriveCanonicalBusinessKey(
  url: string,
  placeId: string | null,
  cid: string | null
): string {
  // Priority: place_id > cid > normalized URL
  if (placeId) {
    return `place_id:${placeId}`;
  }
  
  if (cid) {
    return `cid:${cid}`;
  }
  
  const normalized = normalizeGoogleMapsUrl(url);
  return `url:${normalized}`;
}

