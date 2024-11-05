## Using Docker

Ensure you have Docker installed on your machine. You can download it from [here](https://www.docker.com/products/docker-desktop). Create a Docker Hub account and access tokens [here](https://app.docker.com/settings/personal-access-tokens); you'll need it later to push your docker images to your repository for development purposes.

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

#### Push the Docker Image to Docker Desktop Repository for Development


1. **Tag the Docker Image**: Tag your Docker image with the repository name. Replace `<your-username>` with your Docker Hub username.
    ```
    docker tag sratrc-portal-backend <your-username>/sratrc-portal-backend:latest
    ```

2. **Login to Docker Hub**: Log in to your Docker Hub account.
    ```
    docker login -u <your-username>
    ```
    Use the access token that has permissions to push images to your repository. Create one, if needed.


3. **Push the Docker Image**: Push the tagged image to Docker Hub.
    ```
    docker push <your-username>/sratrc-portal-backend:latest
    ```

After pushing, you can pull and run this image from any machine with Docker installed by using:
```
docker pull <your-username>/sratrc-portal-backend:latest
```

## Using Kubernetes

#### Create a Docker Desktop Registry Secret for Development

You need to create a Kubernetes Secret to store the Docker registry credentials and reference it in your Deployment.

```
kubectl create secret docker-registry myregistrykey \
  --docker-server=docker.io \
  --docker-username=<your-username> \
  --docker-password=<your-access-token> \
  --docker-email=<your-email>
```

#### Creating Kubernetes Resources 

```
kubectl apply -f kubernetes/development/configmap.yaml
kubectl apply -f kubernetes/development/secret.yaml
kubectl apply -f kubernetes/development/deployment.yaml
kubectl apply -f kubernetes/development/service.yaml
```

```
kubectl get deployments,services,pods -l app=sratrc-portal-backend
```

## Database Schema

#### ERD 
![ERD](./docs/images/ERD.png)
