# Bibliotheca - Book Release Tracker 📚

A beautiful, secure book tracking application that helps you keep track of upcoming releases from your favorite authors and series.

## Features

✨ **Live Book Search** - Search millions of books via Google Books API  
📅 **Calendar View** - See upcoming releases at a glance  
⭐ **Follow Authors & Series** - Never miss a new release  
🛡️ **Rate Limited** - Fair usage with 50 searches per user per day  
🎨 **Beautiful UI** - Elegant, paper-inspired design  
🔒 **Secure** - API key protected on backend

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Start the Backend

```bash
npm start
```

The server will run on `http://localhost:3001`

### 3. Start the Frontend

In a separate terminal:

```bash
# If using Create React App
npm start

# If using Vite  
npm run dev
```

### 4. Open Your Browser

Navigate to `http://localhost:3000` (or whatever port your frontend uses)

## How It Works

### Architecture

```
User → React Frontend → Express Backend → Google Books API
                            ↑
                    (API Key Protected)
                    (Rate Limited: 50/day)
```

### Rate Limiting

- **50 searches per day** per IP address
- Resets every 24 hours at midnight Pacific Time
- Caching reduces duplicate requests (1 hour TTL)
- Fair usage for all users

## API Endpoints

### Search Books
```
GET /api/books/search?query=brandon+sanderson
```

### Get Book Details
```
GET /api/books/:googleBooksId
```

### Check Rate Limit
```
GET /api/rate-limit-status
```

## Environment Variables

The `.env` file contains your API key (already configured):

```env
GOOGLE_BOOKS_API_KEY=AIzaSyB_DDn21AYWrztDH2U8dJvYmfAC1aDx9Bk
PORT=3001
NODE_ENV=development
```

**⚠️ Important:** Never commit `.env` to version control!

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed deployment instructions for:
- Heroku
- Vercel
- DigitalOcean
- Traditional VPS

## Tech Stack

### Frontend
- React
- Lucide Icons
- Google Fonts (Cormorant Garamond)

### Backend
- Node.js
- Express
- express-rate-limit
- dotenv

## Security Features

✅ API key stored securely on backend  
✅ Rate limiting prevents abuse  
✅ CORS enabled for cross-origin requests  
✅ Input validation and sanitization  
✅ Error messages don't expose sensitive info

## Usage

1. **Click "Add Book"** to search for books
2. **Search** by title, author, or series
3. **Track books** you're interested in (coming soon)
4. **View calendar** to see upcoming releases
5. **Follow authors** to get all their new books

## Development

### Run in Development Mode

```bash
# Backend with auto-reload
npm run dev

# Frontend
npm start
```

### Project Structure

```
bibliotheca/
├── server.js              # Express backend
├── book-tracker.jsx       # React frontend
├── package.json           # Dependencies
├── .env                   # Environment variables
└── .gitignore            # Git ignore rules
```

## What's Next?

Planned features:

- [ ] Database integration for persistent storage
- [ ] User authentication and accounts
- [ ] Email notifications for upcoming releases
- [ ] Series tracking and grouping
- [ ] Goodreads CSV import
- [ ] Mobile app (React Native)
- [ ] Release date scraping from publishers

## Troubleshooting

### Backend won't start
- Check that port 3001 is available
- Verify `.env` file exists with API key

### Search not working
- Ensure backend is running
- Check browser console for errors
- Verify frontend is pointing to `http://localhost:3001/api`

### Rate limit exceeded
- Wait 24 hours for reset
- Or restart server (development only)

## Contributing

Contributions welcome! Areas for improvement:

- Additional book APIs (Open Library, etc.)
- Database models for storing tracked books
- User authentication system
- Notification system
- Mobile responsive design
- Dark mode toggle

## License

MIT

## Credits

- Book data powered by [Google Books API](https://developers.google.com/books)
- Icons by [Lucide](https://lucide.dev)
- Fonts by [Google Fonts](https://fonts.google.com)

---

Built with ❤️ for book lovers everywhere
