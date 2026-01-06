// service-worker.js - Background script for API calls, messaging, and storage

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'analyzeCredibility') {
    handleAnalysis(request.tabId, request.url, sendResponse);
    return true; // Keep message channel open for async response
  }
});

// Main analysis handler
async function handleAnalysis(tabId, url, sendResponse) {
  try {
    // Step 1: Extract article content from the page
    const articleText = await extractArticleContent(tabId);
    
    if (!articleText || articleText.trim().length < 100) {
      sendResponse({ error: 'Could not extract sufficient article content from this page' });
      return;
    }

    // Step 2: Get API key from storage
    const result = await chrome.storage.sync.get(['geminiApiKey']);
    const apiKey = result.geminiApiKey;

    if (!apiKey) {
      sendResponse({ error: 'API key not found. Please save your API key first.' });
      return;
    }

    // Step 3: Call Gemini API for analysis
    const analysisData = await callGeminiAPI(articleText, url, apiKey);

    // Step 4: Save to history
    await saveToHistory(url, analysisData);

    // Step 5: Send response back to popup
    sendResponse({ data: analysisData });

  } catch (error) {
    console.error('Analysis error:', error);
    sendResponse({ error: error.message });
  }
}

// Extract article content from the active tab
async function extractArticleContent(tabId) {
  try {
    // Inject and execute content script
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        // Extract main article content
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

        // Limit to first 3000 characters to avoid token limits and ensure complete responses
        return articleText.substring(0, 3000);
      }
    });

    return results[0].result;
  } catch (error) {
    throw new Error(`Failed to extract article content: ${error.message}`);
  }
}

// Call Gemini API with article content
async function callGeminiAPI(articleText, pageUrl, apiKey) {
  // Using Gemini 3 Flash with thinking mode
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=${apiKey}`; 


  // Create the prompt with structured evaluation steps
  const prompt = `You are a credibility analysis expert performing a structured evaluation. Give a final credibility_score that includes all the factors of the five steps after analyzing.

CURRENT DATE: January 3, 2026

Pull relevant and recent information only to verify claims and find corroborating sources.

Article URL: ${pageUrl}

Article Content:
${articleText}

Analyze the article strictly in the following order and do not skip any step internally, and be conservative:

1. Source reliability - Score out of 100
2. Evidence and citations - Score out of 100
3. Writing quality and professionalism - Score out of 100
4. Objectivity and bias indicators - Score out of 100
5. Logical consistency and factual coherence - Score out of 100
6. Political lean

After completing all steps, calculate a final credibility_score (0-100) that weighs all factors.

CRITICAL INSTRUCTIONS:
1. Respond with ONLY a valid JSON object
2. No markdown code blocks (no \`\`\`json)
3. No additional text before or after the JSON
4. Ensure all strings are properly escaped (use \\\\ for backslashes, \\" for quotes)
5. Do not include line breaks within string values

Required JSON schema:
{
  "credibility_score": <integer 0-100, conservative final score after all steps>,
  "reasoning_summary": "<concise explanation that references your evaluation across all 6 steps>",
  "political_leaning": "<one of: Left, Center-Left, Center, Center-Right, Right, or Neutral>",
  "corroboration_analysis": [
    {
      "title": "<source title>",
      "source_url": "<valid URL>",
      "corroboration_score": <integer 0-100 reflecting how well this source corroborates the article>
    }
  ]
}

Find 2-3 corroborating sources that discuss the same topic and score how well they support or contradict the article's claims. Return ONLY the JSON object.`;

  // Construct request body for Gemini API with new settings
  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: prompt
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.15, // Changed from 0.3 to 0.15 for more consistent output
      maxOutputTokens: 4096
    },
    tools: [
      {
        googleSearch: {} // Enable grounding with Google Search
      }
    ],
    systemInstruction: {
      parts: [
        {
          text: "You are a credibility analysis expert. Use web search to verify facts and find corroborating sources. Be thorough and conservative in your scoring."
        }
      ]
    }
  };

  try {
    // Make API call
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('API Error Response:', errorData);
      throw new Error(`Gemini API error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    console.log('API Response:', data);

    // Check if content was blocked by safety filters
    if (data.promptFeedback && data.promptFeedback.blockReason) {
      throw new Error(`Content blocked by safety filters: ${data.promptFeedback.blockReason}`);
    }

    // Check if response was blocked or filtered
    if (!data.candidates || data.candidates.length === 0) {
      if (data.promptFeedback) {
        throw new Error(`No response generated. Reason: ${JSON.stringify(data.promptFeedback)}`);
      }
      throw new Error('No response generated by API - content may have been filtered');
    }

    // Check finish reason
    const candidate = data.candidates[0];
    if (candidate.finishReason && candidate.finishReason !== 'STOP') {
      console.warn('Unusual finish reason:', candidate.finishReason);
      if (candidate.finishReason === 'SAFETY') {
        throw new Error('Response blocked by safety filters');
      }
      if (candidate.finishReason === 'MAX_TOKENS') {
        throw new Error('Response incomplete - hit token limit. Try a shorter article.');
      }
    }

    // Parse the response from Gemini API
    console.log('Full API response:', JSON.stringify(data, null, 2));
    
    if (!candidate.content || !candidate.content.parts) {
      console.error('No content in candidate:', candidate);
      throw new Error('Invalid response structure from Gemini API - no content found');
    }

    const responseText = candidate.content.parts[0].text;

    // Parse JSON from response text
    let analysisData;
    try {
      // Remove any markdown code blocks if present
      let cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();
      
      // Sometimes the model adds extra text before/after JSON, extract just the JSON object
      const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanedText = jsonMatch[0];
      }
      
      // Fix common JSON issues: replace newlines within strings with spaces
      cleanedText = cleanedText.replace(/"[^"]*"/g, (match) => {
        return match.replace(/\n/g, ' ').replace(/\s+/g, ' ');
      });
      
      // Try to fix incomplete JSON by adding closing brackets if needed
      const openBraces = (cleanedText.match(/\{/g) || []).length;
      const closeBraces = (cleanedText.match(/\}/g) || []).length;
      const openBrackets = (cleanedText.match(/\[/g) || []).length;
      const closeBrackets = (cleanedText.match(/\]/g) || []).length;
      
      // Add missing closing brackets/braces
      if (openBrackets > closeBrackets) {
        cleanedText += ']'.repeat(openBrackets - closeBrackets);
      }
      if (openBraces > closeBraces) {
        cleanedText += '}'.repeat(openBraces - closeBraces);
      }
      
      analysisData = JSON.parse(cleanedText);
    } catch (parseError) {
      // If parsing fails, log the response for debugging
      console.error('Failed to parse response:', responseText);
      throw new Error(`Failed to parse API response as JSON: ${parseError.message}. Response was: ${responseText.substring(0, 200)}`);
    }

    // Validate the response structure
    if (!analysisData.credibility_score || !analysisData.reasoning_summary) {
      console.error('Missing required fields in parsed data:', analysisData);
      throw new Error('API response missing required fields (credibility_score or reasoning_summary)');
    }

    // Add defaults for optional fields (removed confidence)
    analysisData.political_leaning = analysisData.political_leaning || 'Neutral';
    analysisData.corroboration_analysis = analysisData.corroboration_analysis || [];

    return analysisData;

  } catch (error) {
    throw new Error(`API call failed: ${error.message}`);
  }
}

// Save analysis to history
async function saveToHistory(url, analysisData) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['analysisHistory'], (result) => {
      const history = result.analysisHistory || [];
      
      // Add new entry
      history.push({
        url: url,
        title: url.split('/')[2], // Extract domain as title
        score: analysisData.credibility_score,
        timestamp: Date.now()
      });

      // Keep only last 20 entries
      const trimmedHistory = history.slice(-20);

      chrome.storage.local.set({ analysisHistory: trimmedHistory }, () => {
        resolve();
      });
    });
  });
}
