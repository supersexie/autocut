# The job list and live progress (REDIS_URL). One primary plus a copy in another zone that takes
# over within about a minute if the primary fails. Every key shares one hash tag, so a single
# primary carries it all: size the machine (var.redis_node_type) rather than adding shards.
resource "aws_elasticache_subnet_group" "redis" {
  name       = var.name
  subnet_ids = module.vpc.private_subnets
}

resource "aws_security_group" "redis" {
  name   = "${var.name}-redis"
  vpc_id = module.vpc.vpc_id
  ingress {
    description     = "From the cluster's machines"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id, module.eks.cluster_primary_security_group_id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "random_password" "redis" {
  length  = 48
  special = false
}

resource "aws_elasticache_parameter_group" "redis" {
  name   = "${var.name}-valkey8"
  family = "valkey8"
  # Jobs must never be evicted to make room.
  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = var.name
  description          = "Autocut job list and live progress"
  engine               = "valkey"
  engine_version       = "8.0"
  node_type            = var.redis_node_type
  parameter_group_name = aws_elasticache_parameter_group.redis.name
  port                 = 6379

  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true

  subnet_group_name  = aws_elasticache_subnet_group.redis.name
  security_group_ids = [aws_security_group.redis.id]

  transit_encryption_enabled = true
  at_rest_encryption_enabled = true
  auth_token                 = random_password.redis.result

  snapshot_retention_limit = 3
  apply_immediately        = true
}
