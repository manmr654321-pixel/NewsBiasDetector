// content-script.js - Extracts article text from the current page
// This file runs in the context of web pages

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

// Comprehensive article text extraction function
function extractArticleText() {
  // Comprehensive list of selectors from major news platforms
  const selectors = [
    // Semantic HTML5
    'article',
    '[role="article"]',
    'main article',
    
    // Common news site patterns
    '.article-body',
    '.article-content',
    '.article__body',
    '.article__content',
    '.story-body',
    '.story-content',
    '.story__body',
    '.post-content',
    '.post-body',
    '.post__content',
    '.entry-content',
    '.entry-body',
    
    // Major news outlets
    '.article-text',
    '.body-content',
    '.text-content',
    '[itemprop="articleBody"]',
    '.content-body',
    '.main-content',
    
    // NYT specific
    '.story-content',
    '.StoryBodyCompanionColumn',
    
    // BBC patterns
    '.story-body__inner',
    '.ssrcss-1q0x1qg-Paragraph',
    
    // CNN patterns
    '.article__content',
    '.zn-body__paragraph',
    
    // Guardian patterns
    '.article-body-commercial-selector',
    '.content__article-body',
    
    // Washington Post
    '.article-body',
    
    // Reuters
    '.ArticleBody__content',
    '.StandardArticleBody_body',
    
    // Fox News
    '.article-body',
    '.article-content',
    
    // NBC/MSNBC
    '.article-body__content',
    
    // AP News
    '.Article',
    
    // USA Today
    '.story-body-text',
    
    // Bloomberg
    '.body-copy',
    
    // Vice
    '.article__body',
    
    // Vox
    '.c-entry-content',
    
    // Buzzfeed
    '.subbuzz-content',
    
    // Medium
    'article section',
    '.postArticle-content',
    
    // WordPress common themes
    '.entry-content',
    '.post-entry',
    '.the-content',
    
    // Generic fallbacks
    'main',
    '.content',
    '#content',
    '.main',
    '#main'
  ];

  let articleText = '';
  let bestMatch = null;
  let maxLength = 0;

  // Try each selector and keep the one with the most text
  for (const selector of selectors) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        const text = element.innerText || element.textContent;
        if (text && text.trim().length > maxLength) {
          maxLength = text.trim().length;
          bestMatch = text;
        }
        // If we found substantial content (>500 chars), use it
        if (maxLength > 500) {
          articleText = bestMatch;
          break;
        }
      }
    } catch (e) {
      // Skip invalid selectors
      continue;
    }
  }

  // Fallback to body if nothing substantial found
  if (!articleText || articleText.trim().length < 200) {
    articleText = document.body.innerText || document.body.textContent;
  }

  // Clean up the text
  articleText = articleText
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/\n{3,}/g, '\n\n') // Remove excessive line breaks
    .trim();

  // Limit to first 5000 characters to avoid token limits
  return articleText.substring(0, 5000);
}
