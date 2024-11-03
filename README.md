## Using Docker

Ensure you have Docker installed on your machine. You can download it from [here](https://www.docker.com/products/docker-desktop).

#### Build the Docker Image
To build the Docker image for your application, use the following command:
```
docker build --no-cache -t sratrc-portal-backend .
```

#### Run the Docker Container
1. To run your dockerized application, use the following command:
    ```
    docker run -p 3000:3000 --add-host=host.docker.internal:host-gateway -e DB_HOST=host.docker.internal -e NODE_ENV=dev sratrc-portal-backend
    ```
   The `--add-host=host.docker.internal:host-gateway` adds host-to-IP mappings to the container's `hosts` file. This is useful to connect to MySQL running on `localhost`.

2. Open a web browser and navigate to `http://localhost:3000` to access the application.

#### Stopping and Removing the Docker Container
1. To stop the running container, use the following command:
    ```
    docker ps
    docker stop <your-container-id>
    ```

2. To remove the stopped container, use the following command:
    ```
    docker rm <your-container-id>
    ```

## Database Schema

#### ERD 
![ERD](./docs/images/ERD.png)
