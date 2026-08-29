FROM node:24-alpine

# Create app directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --no-optional

# Copy source code
COPY . .

# Build the TypeScript code
RUN npm run build

# Expose the port if needed (for future HTTP server support)
# EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production

# Run the server
CMD ["node", "dist/index.js"]
