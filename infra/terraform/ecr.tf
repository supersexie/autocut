# Where the images go: the server (API and cut workers), the GPU export worker, and speech-to-text.
resource "aws_ecr_repository" "images" {
  for_each             = toset(["server", "server-gpu", "asr"])
  name                 = "${var.name}/${each.key}"
  image_tag_mutability = "MUTABLE"
  force_delete         = false
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_lifecycle_policy" "images" {
  for_each   = aws_ecr_repository.images
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 30 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 30 }
      action       = { type = "expire" }
    }]
  })
}
