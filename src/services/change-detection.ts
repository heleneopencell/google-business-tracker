import { Snapshot } from '../types/snapshot';

export function detectChanges(baseline: Snapshot | null, current: Snapshot): string {
  if (!baseline) {
    return ''; // No baseline, no changes
  }

  const changes: string[] = [];

  // Link: added|removed|changed
  if (baseline.link !== current.link) {
    if (!baseline.link && current.link) {
      changes.push('Link: added');
    } else if (baseline.link && !current.link) {
      changes.push('Link: removed');
    } else {
      changes.push('Link: changed');
    }
  }

  // Name: changed
  if (baseline.name !== current.name && baseline.name && current.name) {
    changes.push('Name: changed');
  }

  // Address: changed|removed
  if (baseline.address !== current.address) {
    if (baseline.address && !current.address) {
      changes.push('Address: removed');
    } else if (baseline.address && current.address) {
      changes.push('Address: changed');
    }
  }

  // Webpage: changed|removed
  if (baseline.webpage !== current.webpage) {
    if (baseline.webpage && !current.webpage) {
      changes.push('Webpage: removed');
    } else if (baseline.webpage && current.webpage) {
      changes.push('Webpage: changed');
    }
  }

  // Phone: changed|removed
  if (baseline.phone !== current.phone) {
    if (baseline.phone && !current.phone) {
      changes.push('Phone: removed');
    } else if (baseline.phone && current.phone) {
      changes.push('Phone: changed');
    }
  }

  // OpenClosedStatus: OLD → NEW
  if (baseline.openClosedStatus !== current.openClosedStatus) {
    changes.push(`OpenClosedStatus: ${baseline.openClosedStatus} → ${current.openClosedStatus}`);
  }

  // ReviewCount: ±X (OLD → NEW)
  if (baseline.reviewCount !== null && current.reviewCount !== null) {
    if (baseline.reviewCount !== current.reviewCount) {
      const diff = current.reviewCount - baseline.reviewCount;
      const sign = diff > 0 ? '+' : '';
      changes.push(`ReviewCount: ${sign}${diff} (${baseline.reviewCount} → ${current.reviewCount})`);
    }
  }

  // StarRating: OLD → NEW (increased|decreased)
  if (baseline.starRating !== null && current.starRating !== null) {
    if (baseline.starRating !== current.starRating) {
      const direction = current.starRating > baseline.starRating ? 'increased' : 'decreased';
      changes.push(`StarRating: ${baseline.starRating} → ${current.starRating} (${direction})`);
    }
  }

  return changes.join('; ');
}

