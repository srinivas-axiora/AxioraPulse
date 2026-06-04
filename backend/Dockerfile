# Use Python 3.11 slim image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Make entrypoint executable
RUN chmod +x entrypoint.sh

# Expose port 8080
EXPOSE 8080

# Set entrypoint
ENTRYPOINT ["./entrypoint.sh"]