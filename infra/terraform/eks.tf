# The Kubernetes cluster. A small fixed group of machines runs the cluster's own services
# (Karpenter, KEDA, the load balancer controller); Karpenter starts every other machine as needed.
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.31"

  cluster_name    = var.name
  cluster_version = var.kubernetes_version

  cluster_endpoint_public_access           = true
  enable_cluster_creator_admin_permissions = true

  cluster_addons = {
    coredns                = {}
    eks-pod-identity-agent = {}
    kube-proxy             = {}
    vpc-cni = {
      before_compute = true
      # Prefix delegation: many more pods per machine, and addresses handed out faster.
      configuration_values = jsonencode({ env = { ENABLE_PREFIX_DELEGATION = "true", WARM_PREFIX_TARGET = "1" } })
    }
  }

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  eks_managed_node_groups = {
    system = {
      ami_type       = "AL2023_ARM_64_STANDARD"
      instance_types = ["m7g.xlarge"]
      min_size       = 3
      max_size       = 6
      desired_size   = 3
      labels         = { "autocut/system" = "true" }
      taints = {
        system = { key = "CriticalAddonsOnly", value = "true", effect = "NO_SCHEDULE" }
      }
    }
  }

  node_security_group_tags = { "karpenter.sh/discovery" = var.name }
}

# Karpenter: starts the cheapest machines that fit whatever pods are waiting, and removes empty ones.
module "karpenter" {
  source  = "terraform-aws-modules/eks/aws//modules/karpenter"
  version = "~> 20.31"

  cluster_name                    = module.eks.cluster_name
  enable_v1_permissions           = true
  enable_pod_identity             = true
  create_pod_identity_association = true
  node_iam_role_use_name_prefix   = false
  node_iam_role_name              = "${var.name}-karpenter-node"
  node_iam_role_additional_policies = {
    AmazonSSMManagedInstanceCore = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
  }
}

data "aws_ecrpublic_authorization_token" "token" {
  provider = aws.virginia
}

resource "helm_release" "karpenter" {
  namespace           = "kube-system"
  name                = "karpenter"
  repository          = "oci://public.ecr.aws/karpenter"
  repository_username = data.aws_ecrpublic_authorization_token.token.user_name
  repository_password = data.aws_ecrpublic_authorization_token.token.password
  chart               = "karpenter"
  version             = var.karpenter_version
  wait                = true

  values = [yamlencode({
    nodeSelector = { "autocut/system" = "true" }
    tolerations  = [{ key = "CriticalAddonsOnly", operator = "Exists" }]
    settings = {
      clusterName       = module.eks.cluster_name
      clusterEndpoint   = module.eks.cluster_endpoint
      interruptionQueue = module.karpenter.queue_name
    }
    controller = { resources = { requests = { cpu = "1", memory = "2Gi" }, limits = { memory = "2Gi" } } }
  })]
}

# KEDA: sizes each worker pool from how many jobs are waiting (GET /queue on the API).
resource "helm_release" "keda" {
  namespace        = "keda"
  create_namespace = true
  name             = "keda"
  repository       = "https://kedacore.github.io/charts"
  chart            = "keda"
  version          = var.keda_version
  values = [yamlencode({
    nodeSelector = { "autocut/system" = "true" }
    tolerations  = [{ key = "CriticalAddonsOnly", operator = "Exists" }]
  })]
}

# Lets pods on GPU machines ask for a GPU (nvidia.com/gpu).
resource "helm_release" "nvidia_device_plugin" {
  namespace  = "kube-system"
  name       = "nvidia-device-plugin"
  repository = "https://nvidia.github.io/k8s-device-plugin"
  chart      = "nvidia-device-plugin"
  version    = var.nvidia_plugin_version
  values = [yamlencode({
    nodeSelector = { "autocut/gpu" = "true" }
    tolerations  = [{ key = "nvidia.com/gpu", operator = "Exists", effect = "NoSchedule" }]
  })]
}

# The AWS load balancer controller: turns the API's Ingress into an Application Load Balancer
# (HTTPS, WebSockets for live progress).
module "lb_controller_role" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.48"

  role_name                              = "${var.name}-lb-controller"
  attach_load_balancer_controller_policy = true
  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:aws-load-balancer-controller"]
    }
  }
}

resource "helm_release" "lb_controller" {
  namespace  = "kube-system"
  name       = "aws-load-balancer-controller"
  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"
  version    = var.lb_controller_version
  values = [yamlencode({
    clusterName = module.eks.cluster_name
    region      = var.region
    vpcId       = module.vpc.vpc_id
    serviceAccount = {
      name        = "aws-load-balancer-controller"
      annotations = { "eks.amazonaws.com/role-arn" = module.lb_controller_role.iam_role_arn }
    }
    nodeSelector = { "autocut/system" = "true" }
    tolerations  = [{ key = "CriticalAddonsOnly", operator = "Exists" }]
  })]
}
