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
        // Try multiple common selectors for article content
        const selectors = [
          'article',
          '[role="article"]',
          'main article',
          '.article-content',
          '.post-content',
          '.entry-content',
          'main',
          '.content'
        ];

        let articleText = '';

        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) {
            articleText = element.innerText;
            break;
          }
        }

        // Fallback to body if nothing found
        if (!articleText || articleText.trim().length < 100) {
          articleText = document.body.innerText;
        }

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
  // Construct the API endpoint with API key as query parameter
  // Using gemini-2.5-flash which is the latest stable model with free tier
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  // Create the prompt that instructs JSON output
  const prompt = `You are a credibility analysis expert. Analyze the following article and provide a credibility assessment.

Article URL: ${pageUrl}

Article Content:
${articleText}

CRITICAL INSTRUCTIONS:
1. Respond with ONLY a valid JSON object
2. No markdown code blocks (no \`\`\`json)
3. No additional text before or after the JSON
4. Ensure all strings are properly escaped (use \\\\ for backslashes, \\" for quotes)
5. Do not include line breaks within string values

Required JSON schema:
{
  "credibility_score": <integer 0-100>,
  "reasoning_summary": "<concise explanation>",
  "confidence": <integer 0-100>,
  "political_leaning": "<one of: Left, Center-Left, Center, Center-Right, Right, or Neutral>",
  "corroboration_analysis": [
    {
      "title": "<source title>",
      "source_url": "<valid URL>",
      "corroboration_score": <integer 0-100>
    }
  ]
}

Evaluate based on: source reliability, citations, writing quality, objectivity, logical consistency.
Provide 2-3 corroborating sources. Return ONLY the JSON object with no other text.`;

  // Construct request body for Gemini API
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
      temperature: 0.3,
      maxOutputTokens: 4096, // Increased from 2048 to allow longer responses
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
      // This regex finds strings and replaces newlines inside them
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

    // Add defaults for optional fields
    analysisData.confidence = analysisData.confidence || 75;
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