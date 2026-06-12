This is a fork of Jason Prado's [bsky-image-bot](https://github.com/jasonprado/bsky-image-bot) that is designed specifically to post *random* images from a set folder, rather than sequential image, and also automatically determine the resolution to satisfy the Bluesky API.

This fork differs significantly in how it functions. Keeping the same description felt not quite right as a result of these significant functional changes. The instructions below **will not work**. If you fork this, it will be a bit of a pain for you, especially since you will have to pull 18,000 *Peanuts* strips as well. As always: no refunds.

**In accordance with the original repository, this is licensed under the traditional MIT license instead of the modified MayaTel Software License usually seen in my repositories.**

ORIGINAL DESCRIPTION:
# bsky-image-bot

This is a simple bot that posts an image to Bluesky on a cron job using GitHub Actions.

## How to use

1. Fork this repo
1. Put your images under `imagequeue/`. Only JPG and PNG images are supported by Bluesky. Commit and push.
1. Edit index.ts to customize parsing of your filenames into post text. Commit and push.
1. Generate an [app password](https://bsky.app/settings/app-passwords) for your Bluesky account.
1. Set Repository Secrets (`github.com/YOUR/REPO/settings/secrets/actions`) `BSKY_IDENTIFIER` and `BSKY_PASSWORD`.
1. Create a [fine-grained GitHub personal token](https://github.com/settings/tokens?type=beta). Give it read/write access to repository variables.
1. Add the token as a secret named `REPO_ACCESS_TOKEN`.
1. Execute the `post-next-image` action from the GitHub UI.
1. When successful, edit `post-next-image.yml` to enable the automated post.
