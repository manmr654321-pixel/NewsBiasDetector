// content-script.js - Extracts article text from the current page
// This file runs in the context of web pages

// Note: The actual content extraction is handled directly in service-worker.js
// using chrome.scripting.executeScript for better control and reliability.
// This file is included in the manifest to satisfy the content_scripts requirement
// but the heavy lifting is done in the service worker.

// This script can be used for future enhancements like:
// - Real-time credibility indicators on the page
// - Highlighting suspicious claims
// - Adding badges to articles

console.log('Credibility Analyzer: Content script loaded');

// Listen for messages from the service worker if needed
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractContent') {
    // Extract and return article content
    const content = extractArticleText();
    sendResponse({ content: content });
  }
  return true;
});

// Helper function to extract article text
function extractArticleText() {
  // Try multiple common selectors for article content
  const selectors = [
    'article',
    '[role="article"]',
    'main article',
    '.article-content',
    '.post-content',
    '.entry-content',
    '.story-body',
    '.article-body',
    'main',
    '.content'
  ];

  let articleText = '';

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      articleText = element.innerText;
      if (articleText.trim().length > 200) {
        break; // Found substantial content
      }
    }
  }

  // Fallback to body if nothing substantial found
  if (!articleText || articleText.trim().length < 200) {
    articleText = document.body.innerText;
  }

  // Clean up the text
  articleText = articleText
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/\n{3,}/g, '\n\n') // Remove excessive line breaks
    .trim();

  // Limit to first 5000 characters to avoid token limits
  return articleText.substring(0, 5000);
}