terraform {
  required_version = ">= 1.6"
  required_providers {
    aws        = { source = "hashicorp/aws", version = "~> 5.80" }
    helm       = { source = "hashicorp/helm", version = "~> 2.16" }
    kubernetes = { source = "hashicorp/kubernetes", version = "~> 2.35" }
    random     = { source = "hashicorp/random", version = "~> 3.6" }
  }
  # Keep the state in S3 once more than one person runs this (see AWS.md):
  # backend "s3" { bucket = "autocut-terraform-state" key = "autocut/<region>.tfstate" region = "us-east-1" }
}

provider "aws" {
  region = var.region
  default_tags { tags = { app = "autocut" } }
}

# ECR Public (where Karpenter's chart lives) is only served from us-east-1.
provider "aws" {
  alias  = "virginia"
  region = "us-east-1"
}

provider "kubernetes" {
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name, "--region", var.region]
  }
}

provider "helm" {
  kubernetes {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name, "--region", var.region]
    }
  }
}
