# One copy of everything per region. To add a region: terraform workspace new eu-west-1, then
# terraform apply -var region=eu-west-1 (see AWS.md, "More regions").

variable "region" {
  description = "AWS region for this copy of Autocut"
  type        = string
  default     = "us-east-1"
}

variable "name" {
  description = "Name used for the cluster and everything around it"
  type        = string
  default     = "autocut"
}

variable "kubernetes_version" {
  type    = string
  default = "1.32"
}

variable "redis_node_type" {
  description = "The job list's Redis machine. r7g.2xlarge handles roughly 100,000 jobs at once with PROGRESS_MS=2000."
  type        = string
  default     = "cache.r7g.2xlarge"
}

variable "karpenter_version" {
  type    = string
  default = "1.5.0"
}

variable "keda_version" {
  type    = string
  default = "2.17.0"
}

variable "nvidia_plugin_version" {
  type    = string
  default = "0.17.1"
}

variable "lb_controller_version" {
  type    = string
  default = "1.13.0"
}

variable "max_cpu" {
  description = "Most vCPUs Karpenter may start for the API and cut workers (keep within your EC2 quota)"
  type        = number
  default     = 200000
}

variable "max_gpus" {
  description = "Most GPUs Karpenter may start for exports and speech-to-text (keep within your G-instance quota)"
  type        = number
  default     = 10000
}
