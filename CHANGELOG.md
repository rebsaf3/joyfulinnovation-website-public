# Changelog

All notable changes to the Joyful Innovation website will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-02-13

### Fixed
- **Navigation Rendering Issues**: Fixed literal `\r\n` characters appearing in navigation and footer links on privacy-policy.html and terms.html pages
- **Broken Favicon References**: Removed broken favicon.svg references from all HTML files (file does not exist in repository)
- **Navigation Text Rendering**: Cleaned up malformed navigation HTML in all pages for proper rendering

### Added
- **Accessibility Improvements**: Added `aria-current="page"` attributes to all active navigation links for screen reader support across all pages:
  - index.html (Home)
  - products.html (Products)
  - product-assetpilot.html (Products breadcrumb)
  - product-flowpilot.html (Products breadcrumb)
  - product-insightpilot.html (Products breadcrumb)
  - insights.html (Insights)
  - faq.html (FAQ)
  - contact.html (Contact)
  - privacy-policy.html (Privacy Policy footer)
  - terms.html (Terms of Service footer)
- **Active Navigation Styling**: Added CSS rule to highlight active nav links with brand color and bold weight:
  ```css
  .nav-links a[aria-current="page"] { 
    color: var(--brand);
    font-weight: 700;
  }
  ```
- **CTA Button Standardization**: Standardized call-to-action button text across product pages for consistency

### Changed
- Unified HTML head section formatting across all pages
- Improved semantic HTML structure for better accessibility
- Standardized footer link structure across all pages

### Files Modified
- contact.html
- faq.html
- index.html
- insights.html
- privacy-policy.html
- products.html
- product-assetpilot.html
- product-flowpilot.html
- product-insightpilot.html
- terms.html
- assets/styles.css

### Testing
- ✅ All internal links verified and working
- ✅ Navigation active states display correctly
- ✅ No broken external resources
- ✅ Screen reader compatibility verified with aria-current attribute

## [1.0.0] - 2026-02-12

### Added
- Initial site launch
- Core pages: Home, Products, Insights, FAQ, Contact
- Product detail pages: NyLi Assets, NyLi Agent, NyLi Insights
- Legal pages: Privacy Policy, Terms of Service
- Responsive CSS framework
- HostGator FTP deployment workflow via GitHub Actions

