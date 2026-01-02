# Extraction Analysis - What We Look For and Where

## Current Extraction Strategy

### 1. **Business Name**
**Priority Order:**
1. Accessibility snapshot - heading role
2. `<h1>` tag (first one)
3. Document title

**Current Selectors:**
- `h1` (first element)
- `page.title()`
- Accessibility tree heading

**Issues:**
- Google Maps may not use `<h1>` for business name
- Title might include "reviews" or "stars" which we filter out
- May need to look for specific data attributes

**Better Selectors to Try:**
- `[data-value="title"]`
- `[data-attrid="title"]`
- `h1[data-attrid="title"]`
- `[data-value="name"]`
- `button[data-value*="title"]`

### 2. **Address**
**Priority Order:**
1. `[data-item-id="address"]`
2. Regex pattern in body text

**Current Selectors:**
- `[data-item-id="address"]`
- Regex: `/(\d+[\s\w]+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|circle|cir)[^,]*,\s*[^,]+)/i`

**Issues:**
- `data-item-id="address"` may not exist in current Google Maps structure
- Regex is too specific for international addresses

**Better Selectors to Try:**
- `[data-item-id="address"]`
- `button[data-item-id="address"]`
- `[aria-label*="Address"]`
- `[data-value*="address"]` (case insensitive)
- Look for address in business panel

### 3. **Phone Number**
**Priority Order:**
1. `[data-item-id^="phone:"]`
2. Regex pattern in body text

**Current Selectors:**
- `[data-item-id^="phone:"]`
- Regex: `/(\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/`

**Issues:**
- `data-item-id` format may have changed
- Regex might match non-phone numbers

**Better Selectors to Try:**
- `[data-item-id^="phone"]`
- `button[data-item-id*="phone"]`
- `[aria-label*="phone"]` (case insensitive)
- `a[href^="tel:"]`
- Look in business info panel

### 4. **Website/Webpage**
**Priority Order:**
1. Link next to "Website" label
2. URL regex in body text

**Current Selectors:**
- `text=/^website$/i` → parent → `a`
- Regex: `/https?:\/\/(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/`

**Issues:**
- "Website" text might not be exact match
- May need to look for link buttons

**Better Selectors to Try:**
- `button[data-item-id="website"]`
- `a[data-item-id="website"]`
- `[aria-label*="website"]` → `a`
- `button:has-text("Website")` → find link
- Look for `href` attributes in business panel

### 5. **Star Rating**
**Priority Order:**
1. Regex in body text: `/(\d+(?:[.,]\d)?)\s*stars?/i`

**Current Selectors:**
- Regex only

**Issues:**
- Very unreliable - depends on text content
- Google Maps uses visual stars, not always text

**Better Selectors to Try:**
- `[aria-label*="star"]` or `[aria-label*="rating"]`
- `[data-value*="rating"]`
- `button[aria-label*="stars"]`
- Look for rating in business header
- Parse from `aria-label` like "4.5 stars"

### 6. **Review Count**
**Priority Order:**
1. Multiple regex patterns
2. K/M/B suffix handling

**Current Selectors:**
- Regex: `/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)\s*reviews?/i`
- Suffix pattern: `/(\d+(?:[.,]\d+)?)\s*([kmb])\s*reviews?/i`

**Issues:**
- Very unreliable - depends on text format
- May not match Google's format

**Better Selectors to Try:**
- `button[aria-label*="reviews"]`
- `[data-value*="review"]`
- Look for review count near rating
- Parse from `aria-label` like "1,234 reviews"

### 7. **Open/Closed Status**
**Priority Order:**
1. Text search: "permanently closed"
2. Text search: "temporarily closed"
3. Text search: "open", "hours", "closed"

**Current Selectors:**
- Body text search (case insensitive)

**Issues:**
- Too generic - may match unrelated text
- Doesn't check specific elements

**Better Selectors to Try:**
- `[data-value*="closed"]`
- `button[aria-label*="closed"]`
- Look for status in business hours section
- Check for "Open now" or "Closed" buttons

## Recommended Improvements

1. **Wait for page to fully load** - Google Maps is dynamic
2. **Use more specific data attributes** - Google Maps uses `data-item-id` extensively
3. **Look in business panel specifically** - Not just entire page
4. **Use aria-labels** - More reliable than text content
5. **Add more wait time** - Let JavaScript render content
6. **Try multiple selector strategies** - Fallback chains

## Google Maps Structure (Typical)

```
Business Panel:
- Title/Name: Usually in header
- Rating: Near title (e.g., "4.5 ★")
- Review count: Next to rating
- Address: In info section
- Phone: In info section (clickable)
- Website: In info section (link)
- Hours/Status: In info section
```

