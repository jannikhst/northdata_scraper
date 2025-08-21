import express, { Request, Response } from 'express';
import { scraper, SearchResult, SuggestionsResult, PageContentResult } from './scraper';
import { Queue } from './queue';
import config from './config';

// Create Express app
const app = express();

// Create queues for requests
const searchQueue = new Queue<SearchResult>();
const suggestionsQueue = new Queue<SuggestionsResult>();
const pageContentQueue = new Queue<PageContentResult>();

// Middleware for parsing JSON
app.use(express.json());

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    searchQueueSize: searchQueue.size,
    suggestionsQueueSize: suggestionsQueue.size,
    pageContentQueueSize: pageContentQueue.size,
    searchQueueProcessing: searchQueue.isProcessing,
    suggestionsQueueProcessing: suggestionsQueue.isProcessing,
    pageContentQueueProcessing: pageContentQueue.isProcessing,
  });
});

// Page content endpoint
app.get('/page', async (req: Request, res: Response) => {
  try {
    const url = req.query.url as string;
    const removeElements = req.query.removeElements as string;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        error: 'Invalid request: url parameter is required and must be a string',
      });
    }

    // Validate that the URL is from northdata.de
    if (!url.startsWith('https://www.northdata.de/')) {
      return res.status(400).json({
        error: 'Invalid request: URL must be from northdata.de',
      });
    }

    // Parse removeElements parameter - default to 'true' (remove by default)
    const shouldRemoveElements = removeElements !== 'false';

    console.log(`Received page content request for: ${url}, removeElements: ${shouldRemoveElements}`);

    // Add page content request to queue
    const result = await pageContentQueue.enqueue(async () => {
      return await scraper.getPageContent(url, shouldRemoveElements);
    });

    // Return the HTML content
    res.status(200).json({
      url: result.url,
      html: result.html,
    });
  } catch (error) {
    console.error('Page content request failed:', error);
    
    res.status(500).json({
      error: 'Page content request failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Suggestions endpoint
app.get('/suggest', async (req: Request, res: Response) => {
  try {
    const query = req.query.query as string;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        error: 'Invalid request: query parameter is required and must be a string',
      });
    }

    console.log(`Received suggestions request for: ${query}`);

    // Add suggestions request to queue
    const result = await suggestionsQueue.enqueue(async () => {
      return await scraper.getSuggestions(query);
    });

    // Return the JSON directly
    res.status(200).json(result.json);
  } catch (error) {
    console.error('Suggestions request failed:', error);
    
    res.status(500).json({
      error: 'Suggestions request failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Search endpoint
app.post('/search', async (req: Request, res: Response) => {
  try {
    const { query } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        error: 'Invalid request: query parameter is required and must be a string',
      });
    }

    console.log(`Received search request for: ${query}`);

    // Add search request to queue
    const result = await searchQueue.enqueue(async () => {
      return await scraper.search(query);
    });

    res.status(200).json({
      query,
      url: result.url,
      html: result.html,
    });
  } catch (error) {
    console.error('Search request failed:', error);
    
    res.status(500).json({
      error: 'Search request failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Initialize the API server
export const startServer = async (): Promise<void> => {
  try {
    // Initialize the browser
    await scraper.initialize();

    // Start the server
    app.listen(config.port, () => {
      console.log(`Server running on port ${config.port}`);
    });

    // Handle shutdown
    const shutdown = async () => {
      console.log('Shutting down server...');
      await scraper.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};
