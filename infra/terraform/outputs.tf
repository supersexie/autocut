output "region" {
  value = var.region
}

output "cluster_name" {
  value = module.eks.cluster_name
}

output "kubeconfig_command" {
  value = "aws eks update-kubeconfig --region ${var.region} --name ${module.eks.cluster_name}"
}

output "ecr_registry" {
  value = split("/", aws_ecr_repository.images["server"].repository_url)[0]
}

output "images" {
  value = { for k, r in aws_ecr_repository.images : k => r.repository_url }
}

# Goes in the autocut-env secret as REDIS_URL (rediss: the connection is encrypted).
output "redis_url" {
  value     = "rediss://:${random_password.redis.result}@${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379"
  sensitive = true
}
