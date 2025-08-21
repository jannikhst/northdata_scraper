import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer';
import config from './config';

// Add stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

/**
 * Click an element using XPath
 * @param page Puppeteer page
 * @param xpath XPath selector for the element
 * @returns Promise<boolean> True if element was found and clicked, false otherwise
 */
async function clickByXPath(page: Page, xpath: string): Promise<boolean> {
  return await page.evaluate((xpath) => {
    const element = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue;

    if (element) {
      (element as HTMLElement).click();
      return true;
    }
    return false;
  }, xpath);
}

/**
 * Set up request interception to block unwanted requests
 * @param page Puppeteer page
 */
async function setupRequestInterception(page: Page): Promise<void> {
  // Only set up interception if not already set up
  if (!page.listenerCount('request')) {
    await page.setRequestInterception(true);

    // Intercept requests and block api.rupt.dev
    page.on('request', (request) => {
      const url = request.url();
      if (url.startsWith('https://api.rupt.dev')) {
        console.log(`Blocking request to: ${url}`);
        return request.abort();
      }
      request.continue();
    });
  }
}

/**
 * Type text with random delays between keystrokes to mimic human typing
 * @param page Puppeteer page
 * @param selector CSS selector or XPath for the input element
 * @param text Text to type
 */
async function typeHumanLike(page: Page, selector: string, text: string): Promise<void> {
  // Determine if the selector is an XPath (starts with /)
  const isXPath = selector.startsWith('/');

  try {
    // Click the input field first
    if (isXPath) {
      // Use clickByXPath helper function
      const elementExists = await clickByXPath(page, selector);

      if (!elementExists) {
        throw new Error(`XPath element not found: ${selector}`);
      }
    } else {
      await page.click(selector);
    }

    // Type each character with a random delay
    for (const char of text) {
      // Random delay between min and max typing delay
      const delay = Math.floor(
        (Math.random() * (config.browser.typingDelay.max - config.browser.typingDelay.min + 1) +
          config.browser.typingDelay.min) / 8
      );

      if (isXPath) {
        // For XPath, use evaluate to find the element and type into it
        await page.evaluate(
          (xpath, character) => {
            const element = document.evaluate(
              xpath,
              document,
              null,
              XPathResult.FIRST_ORDERED_NODE_TYPE,
              null
            ).singleNodeValue as HTMLInputElement;

            if (element && element.value !== undefined) {
              element.value += character;
            }
          },
          selector,
          char
        );

        // Add delay between keystrokes
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        await page.type(selector, char, { delay });
      }
    }
  } catch (error) {
    console.error(`Error in typeHumanLike with selector "${selector}":`, error);
    throw error;
  }

  // Small pause after typing is complete
  await new Promise(resolve => setTimeout(resolve, 50));
}

/**
 * Navigate to a URL and wait for network to be idle
 * @param page Puppeteer page
 * @param url URL to navigate to
 */
async function navigateAndWait(page: Page, url: string): Promise<void> {
  await page.goto(url, {
    timeout: config.browser.timeout,
    waitUntil: config.browser.waitForNetworkIdle ? 'networkidle2' as const : 'load' as const,
  });
}

export interface SearchResult {
  html: string;
  url: string;
}

export interface SuggestionsResult {
  json: any;
  url: string;
}

export interface PageContentResult {
  html: string;
  url: string;
}

export class NorthDataScraper {
  private browser: Browser | null = null;
  private isLoggedIn = false;

  /**
   * Initialize the browser
   */
  public async initialize(): Promise<void> {
    if (this.browser) {
      return;
    }

    try {
      this.browser = await puppeteer.launch({
        headless: config.browser.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        timeout: config.browser.timeout,
      });

      console.log(`Browser initialized in ${config.browser.headless ? 'headless' : 'debug (non-headless)'} mode`);
    } catch (error) {
      console.error('Failed to initialize browser:', error);
      throw error;
    }
  }

  /**
   * Close the browser
   */
  public async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.isLoggedIn = false;
      console.log('Browser closed');
    }
  }

  /**
   * Login to northdata.de
   */
  private async login(page: Page): Promise<void> {
    if (this.isLoggedIn) {
      return;
    }

    try {
      console.log('Logging in to northdata.de...');

      // Set up request interception
      await setupRequestInterception(page);

      // Navigate directly to login page
      await navigateAndWait(page, 'https://www.northdata.de/_login');

      // Fill in login form with human-like typing using XPath selectors
      await typeHumanLike(page, '/html/body/main/div/div/div/div[1]/form/div[1]/input', config.northdata.username);
      await typeHumanLike(page, '/html/body/main/div/div/div/div[1]/form/div[2]/input', config.northdata.password);

      // Small pause before submitting form
      await new Promise(resolve => setTimeout(resolve, 50));


      // Submit form using XPath for the submit button
      const submitButtonXPath = '/html/body/main/div/div/div/div[1]/form/button';

      // Click the submit button and wait for navigation
      await Promise.all([
        clickByXPath(page, submitButtonXPath),
        page.waitForNavigation({
          timeout: config.browser.timeout,
          waitUntil: config.browser.waitForNetworkIdle ? 'networkidle2' as const : 'load' as const,
        }),
      ]);

      // Check if login was successful
      const errorElement = await page.$('.error-message');
      if (errorElement) {
        const errorText = await page.evaluate(el => el.textContent, errorElement);
        throw new Error(`Login failed: ${errorText}`);
      }

      this.isLoggedIn = true;
      console.log('Successfully logged in to northdata.de');
    } catch (error) {
      console.error('Login failed:', error);
      this.isLoggedIn = false;
      throw error;
    }
  }

  /**
   * Get page content from a specific northdata.de URL
   */
  public async getPageContent(url: string, shouldRemoveElements = true, retryCount = 0): Promise<PageContentResult> {
    if (!this.browser) {
      await this.initialize();
    }

    if (!this.browser) {
      throw new Error('Browser initialization failed');
    }

    const page = await this.browser.newPage();
    
    try {
      // Set up request interception
      await setupRequestInterception(page);
      
      // Set viewport and user agent
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      
      // Login if not already logged in
      await this.login(page);
      
      // Navigate to the requested URL
      await navigateAndWait(page, url);
      
      // Extract only the main content section and clean the HTML
      const cleanedHtml = await page.evaluate((shouldRemoveElements: boolean) => {
        // Find the main content section
        const mainSection = document.evaluate(
          '/html/body/main/div/section', 
          document, 
          null, 
          XPathResult.FIRST_ORDERED_NODE_TYPE, 
          null
        ).singleNodeValue;
        
        if (!mainSection) {
          return '';
        }
        
        // Clone the section to avoid modifying the original DOM
        const sectionClone = mainSection.cloneNode(true) as HTMLElement;
        
        // Remove elements with specific classes if shouldRemoveElements is true
        if (shouldRemoveElements) {
          // Remove elements with class "history ui"
          const historyElements = sectionClone.querySelectorAll('.history.ui, [class*="history ui"], [class*="history"][class*="ui"]');
          historyElements.forEach(el => el.remove());
          
          // Remove elements with class "network ui"
          const networkElements = sectionClone.querySelectorAll('.network.ui, [class*="network ui"], [class*="network"][class*="ui"]');
          networkElements.forEach(el => el.remove());
        }
        
        // Remove all script tags
        const scripts = sectionClone.querySelectorAll('script');
        scripts.forEach(script => script.remove());
        
        // Remove all style tags
        const styles = sectionClone.querySelectorAll('style');
        styles.forEach(style => style.remove());
        
        // Remove all inline styles
        const elementsWithStyle = sectionClone.querySelectorAll('[style]');
        elementsWithStyle.forEach(el => el.removeAttribute('style'));
        
        // Remove all class attributes (which often reference CSS) - but do this after removing specific elements
        const elementsWithClass = sectionClone.querySelectorAll('[class]');
        elementsWithClass.forEach(el => el.removeAttribute('class'));
        
        // Remove links selectively - keep only northdata.de/{path} links, but not ?id= links
        const links = sectionClone.querySelectorAll('a');
        links.forEach(link => {
          const href = link.getAttribute('href');
          
          // Check if this is a link we want to keep
          const shouldKeepLink = href && (
            // Absolute northdata.de links (but not root URL or ?id= links)
            (href.startsWith('https://www.northdata.de/') && 
             !href.includes('?id=') &&
             href !== 'https://www.northdata.de/') ||
            // Relative links starting with / (but not ?id= links or root)
            (href.startsWith('/') && 
             !href.includes('?id=') &&
             href !== '/')
          );
          
          if (shouldKeepLink) {
            // Convert relative links to absolute links
            if (href && href.startsWith('/') && !href.startsWith('https://')) {
              link.setAttribute('href', 'https://www.northdata.de' + href);
            }
          } else {
            // Remove the link but keep its text content
            if (link.textContent) {
              const textNode = document.createTextNode(link.textContent);
              // Replace the link with just its text content
              link.parentNode?.replaceChild(textNode, link);
            } else {
              // If the link has no text content, just remove it
              link.remove();
            }
          }
        });
        
        // Remove all images
        const images = sectionClone.querySelectorAll('img');
        images.forEach(img => img.remove());
        
        // Remove all buttons
        const buttons = sectionClone.querySelectorAll('button');
        buttons.forEach(button => button.remove());
        
        // Remove all forms
        const forms = sectionClone.querySelectorAll('form');
        forms.forEach(form => form.remove());
        
        // Remove all inputs
        const inputs = sectionClone.querySelectorAll('input');
        inputs.forEach(input => input.remove());
        
        // Remove all iframes
        const iframes = sectionClone.querySelectorAll('iframe');
        iframes.forEach(iframe => iframe.remove());
        
        // Remove all event handlers (onclick, onmouseover, etc.)
        const allElements = sectionClone.querySelectorAll('*');
        allElements.forEach(el => {
          const attributes = Array.from(el.attributes);
          attributes.forEach(attr => {
            // For links, only remove href if it's not a northdata.de/{path} link we want to keep
            if (attr.name === 'href' && el.tagName.toLowerCase() === 'a') {
              const href = attr.value;
              const shouldKeepLink = href && (
                // Absolute northdata.de links (but not root URL or ?id= links)
                (href.startsWith('https://www.northdata.de/') && 
                 !href.includes('?id=') &&
                 href !== 'https://www.northdata.de/') ||
                // Relative links starting with / (but not ?id= links or root) - these should have been converted to absolute already
                (href.startsWith('/') && 
                 !href.includes('?id=') &&
                 href !== '/')
              );
              
              if (!shouldKeepLink) {
                el.removeAttribute(attr.name);
              }
            }
            // Remove all other non-essential attributes
            else if (attr.name.startsWith('on') || 
                attr.name === 'src' || 
                attr.name === 'id' || 
                attr.name === 'target' || 
                attr.name === 'rel') {
              el.removeAttribute(attr.name);
            }
          });
        });
        
        // Remove empty elements that don't contain text
        const removeEmptyElements = (element: Element) => {
          const children = Array.from(element.children);
          
          // Process children first (depth-first)
          children.forEach(child => removeEmptyElements(child));
          
          // Check if element is now empty (no text content and no children)
          if (!element.textContent?.trim() && element.children.length === 0) {
            // Don't remove essential structural elements
            if (element.tagName.toLowerCase() !== 'div' && 
                element.tagName.toLowerCase() !== 'section' && 
                element.tagName.toLowerCase() !== 'article') {
              element.remove();
            }
          }
        };
        
        // Apply the empty element removal
        removeEmptyElements(sectionClone);
        
        // Get the HTML content
        let html = sectionClone.outerHTML;
        
        // Remove unnecessary whitespace
        html = html
          // Replace multiple spaces with a single space
          .replace(/\s+/g, ' ')
          // Remove spaces between tags
          .replace(/>\s+</g, '><')
          // Remove spaces at the beginning of lines
          .replace(/^\s+/gm, '')
          // Remove spaces at the end of lines
          .replace(/\s+$/gm, '')
          // Normalize newlines
          .replace(/\n+/g, '\n')
          // Remove whitespace around specific tags
          .replace(/\s*(<\/?(?:div|p|section|table|tr|td|th|ul|ol|li|h[1-6])[^>]*>)\s*/g, '$1');
        
        return html;
      }, shouldRemoveElements);
      
      const currentUrl = page.url();
      
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, config.browser.requestDelay));
      
      await page.close();
      
      return {
        html: cleanedHtml,
        url: currentUrl,
      };
    } catch (error) {
      await page.close();
      
      // Retry logic
      if (retryCount < config.browser.maxRetries) {
        console.log(`Page content request failed, retrying (${retryCount + 1}/${config.browser.maxRetries})...`);
        // Reset browser for next attempt
        await this.close();
        await this.initialize();
        return this.getPageContent(url, shouldRemoveElements, retryCount + 1);
      }
      
      console.error('Page content request failed after retries:', error);
      throw error;
    }
  }

  /**
   * Get suggestions from northdata.de
   */
  public async getSuggestions(query: string, retryCount = 0): Promise<SuggestionsResult> {
    if (!this.browser) {
      await this.initialize();
    }

    if (!this.browser) {
      throw new Error('Browser initialization failed');
    }

    const page = await this.browser.newPage();

    try {
      // Set up request interception
      await setupRequestInterception(page);

      // Set viewport and user agent
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

      // Login if not already logged in
      await this.login(page);

      // Construct the suggestions URL
      const suggestUrl = `https://www.northdata.de/suggest.json?query=${encodeURIComponent(query)}&countries=DE`;

      // Navigate to the suggestions URL
      await navigateAndWait(page, suggestUrl);

      // Get the JSON content from the page
      const jsonContent = await page.evaluate(() => {
        try {
          return JSON.parse(document.body.textContent || '{}');
        } catch (error) {
          return {};
        }
      });

      const currentUrl = page.url();

      await page.close();

      return {
        json: jsonContent,
        url: currentUrl,
      };
    } catch (error) {
      await page.close();

      // Retry logic
      if (retryCount < config.browser.maxRetries) {
        console.log(`Suggestions request failed, retrying (${retryCount + 1}/${config.browser.maxRetries})...`);
        // Reset browser for next attempt
        await this.close();
        await this.initialize();
        return this.getSuggestions(query, retryCount + 1);
      }

      console.error('Suggestions request failed after retries:', error);
      throw error;
    }
  }

  /**
   * Search for a company on northdata.de
   */
  public async search(query: string, retryCount = 0): Promise<SearchResult> {
    if (!this.browser) {
      await this.initialize();
    }

    if (!this.browser) {
      throw new Error('Browser initialization failed');
    }

    const page = await this.browser.newPage();

    try {
      // Set up request interception
      await setupRequestInterception(page);

      // Set viewport and user agent
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

      // Login if not already logged in
      await this.login(page);

      // Navigate to search page
      await navigateAndWait(page, 'https://www.northdata.de/');

      // Type search query with human-like typing using XPath
      const searchInputXPath = '/html/body/main/div/div/div/form/div/input';
      await typeHumanLike(page, searchInputXPath, query);

      // Small pause before submitting search
      await new Promise(resolve => setTimeout(resolve, 500));

      // Submit search form using XPath
      const searchButtonXPath = '/html/body/main/div/div/div/form/div/button';

      // Click the search button and wait for navigation
      await Promise.all([
        clickByXPath(page, searchButtonXPath),
        page.waitForNavigation({
          timeout: config.browser.timeout,
          waitUntil: config.browser.waitForNetworkIdle ? 'networkidle2' as const : 'load' as const,
        }),
      ]);

      // Additional wait for network idle
      if (config.browser.waitForNetworkIdle) {
        await new Promise(resolve => setTimeout(resolve, config.browser.networkIdleTimeout));
      }

      // Wait for search results to load
      await page.waitForSelector('.search-results', { timeout: config.browser.timeout });

      // Extract search results HTML
      const resultsHtml = await page.evaluate(() => {
        const resultsElement = document.querySelector('.search-results');
        return resultsElement ? resultsElement.outerHTML : '';
      });

      const currentUrl = page.url();

      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, config.browser.requestDelay));

      await page.close();

      return {
        html: resultsHtml,
        url: currentUrl,
      };
    } catch (error) {
      await page.close();

      // Retry logic
      if (retryCount < config.browser.maxRetries) {
        console.log(`Search failed, retrying (${retryCount + 1}/${config.browser.maxRetries})...`);
        // Reset browser for next attempt
        await this.close();
        await this.initialize();
        return this.search(query, retryCount + 1);
      }

      console.error('Search failed after retries:', error);
      throw error;
    }
  }
}

// Create and export a singleton instance
export const scraper = new NorthDataScraper();
