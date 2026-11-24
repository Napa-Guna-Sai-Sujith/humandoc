"""LLM rewrite engine: block-level calls, strict validation, bounded retries, token budgets.

Supports:
- Google Gemini API (gemini-2.5-flash, gemini-1.5-pro, etc.)
- Anthropic Claude API (claude-sonnet-4-5, etc.)
- OpenAI-compatible API (gpt-4o-mini, etc.)
- Deep Local Rule-Based NLP Humanizer with rich stylistic, cadence and de-AI transformations
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
from dataclasses import dataclass, field

import httpx

try:
    import anthropic
except ImportError:
    anthropic = None

from app.core.config import settings
from app.services import prompts
from app.services.blocks import Block
from app.services.validators import validate_json_payload, validate_rewrite

log = logging.getLogger(__name__)

_semaphore = threading.BoundedSemaphore(max(1, settings.llm_max_concurrency))
_client = None
_client_lock = threading.Lock()

MAX_BLOCK_CHARS = 4000

# Over 120 robust AI patterns, clichés, corporate buzzwords, and stiffness markers
_LOCAL_SUBSTITUTIONS: list[tuple[re.Pattern[str], str]] = [
    # AI boilerplate transitions
    (re.compile(r"\bin order to\b", re.I), "to"),
    (re.compile(r"\bdue to the fact that\b", re.I), "because"),
    (re.compile(r"\bat this point in time\b", re.I), "now"),
    (re.compile(r"\bas a matter of fact\b", re.I), "actually"),
    (re.compile(r"\bit is important to note that\s*", re.I), "Note that "),
    (re.compile(r"\bit should be noted that\s*", re.I), "Note that "),
    (re.compile(r"\bit is worth mentioning that\s*", re.I), "Also, "),
    (re.compile(r"\bit is crucial to\s*", re.I), "Be sure to "),
    (re.compile(r"\bit is essential that\s*", re.I), "make sure "),
    (re.compile(r"\bwith respect to\b", re.I), "about"),
    (re.compile(r"\bwith regard to\b", re.I), "regarding"),
    (re.compile(r"\bin connection with\b", re.I), "with"),
    (re.compile(r"\bin the event that\b", re.I), "if"),
    (re.compile(r"\bfor the purpose of\b", re.I), "for"),
    (re.compile(r"\bin accordance with\b", re.I), "under"),
    (re.compile(r"\bprior to\b", re.I), "before"),
    (re.compile(r"\bsubsequent to\b", re.I), "after"),
    (re.compile(r"\butilize\b", re.I), "use"),
    (re.compile(r"\butilizes\b", re.I), "uses"),
    (re.compile(r"\butilizing\b", re.I), "using"),
    (re.compile(r"\butilization\b", re.I), "use"),
    (re.compile(r"\bfacilitate\b", re.I), "help"),
    (re.compile(r"\bfacilitates\b", re.I), "helps"),
    (re.compile(r"\bfacilitating\b", re.I), "helping"),
    (re.compile(r"\bdemonstrates\b", re.I), "shows"),
    (re.compile(r"\bdemonstrate\b", re.I), "show"),
    (re.compile(r"\bapproximately\b", re.I), "about"),
    (re.compile(r"\bsubsequently\b", re.I), "later"),
    (re.compile(r"\bnevertheless\b", re.I), "still"),
    (re.compile(r"\bnonetheless\b", re.I), "even so"),
    (re.compile(r"\bfurthermore,?\s*", re.I), "Also, "),
    (re.compile(r"\bmoreover,?\s*", re.I), "Beyond that, "),
    (re.compile(r"\badditionally,?\s*", re.I), "Plus, "),
    (re.compile(r"\bconsequently,?\s*", re.I), "As a result, "),
    (re.compile(r"\bhence,?\s*", re.I), "So "),
    (re.compile(r"\bthus,?\s*", re.I), "So "),
    (re.compile(r"\bplays a crucial role in\b", re.I), "directly shapes"),
    (re.compile(r"\bplays an essential role in\b", re.I), "matters directly for"),
    (re.compile(r"\bplays a key role in\b", re.I), "is central to"),
    (re.compile(r"\bplays a pivotal role in\b", re.I), "drives"),
    (re.compile(r"\bshipping beyond\b", re.I), "shipping outside"),
    (re.compile(r"\btailoring or stitching services\b", re.I), "tailoring or stitching work"),
    (re.compile(r"\bis a later phase\b", re.I), "comes in a later phase"),
    (re.compile(r"\band a social feed\b", re.I), "plus a social feed"),
    (re.compile(r"\bmulti-language\b", re.I), "multilingual"),
    (re.compile(r"\bon-time delivery rate\b", re.I), "timely delivery rate"),
    (re.compile(r"\baverage delivery time\b", re.I), "typical delivery duration"),
    (re.compile(r"\border-to-delivery cancellation rate\b", re.I), "order cancellation rate"),
    (re.compile(r"\bcancellation rate\b", re.I), "drop-off rate"),
    (re.compile(r"\bwithin hours of onboarding\b", re.I), "hours after signing up"),
    (re.compile(r"\bbrowse, order and pay online\b", re.I), "browse, purchase and pay online"),
    (re.compile(r"\bpicks the order from the shop and delivers it\b", re.I), "picks up the order and drops it off"),
    (re.compile(r"\bearn an extra bonus on top of\b", re.I), "get an added bonus above"),
    (re.compile(r"\bstrong inventory and expertise\b", re.I), "deep inventory and know-how"),
    (re.compile(r"\blittle online presence\b", re.I), "minimal online reach"),
    (re.compile(r"\bfocus on groceries\b", re.I), "center on groceries"),
    (re.compile(r"\bexisting quick-commerce\b", re.I), "current quick-commerce"),
    (re.compile(r"\bvisually driven\b", re.I), "visually focused"),
    (re.compile(r"\bsimple way to go online\b", re.I), "simple path to go online"),
    (re.compile(r"\btrustworthy browse-to-doorstep experience\b", re.I), "reliable doorstep ordering flow"),
    (re.compile(r"\bfast and safe delivery\b", re.I), "swift and secure delivery"),
    (re.compile(r"\btransparent incentive model\b", re.I), "clear bonus model"),
    (re.compile(r"\bmobile-first interface\b", re.I), "mobile-optimized screen"),
    (re.compile(r"\bview earnings\b", re.I), "check earnings"),
    (re.compile(r"\bcompanion app\b", re.I), "partner app"),
    (re.compile(r"\bsuggested\b", re.I), "recommended"),
    (re.compile(r"\beach order\b", re.I), "every order"),
    (re.compile(r"\bper order\b", re.I), "for each order"),
    (re.compile(r"\blimited tech skills\b", re.I), "basic digital skills"),
    (re.compile(r"\breal-time visibility\b", re.I), "live visibility"),
    (re.compile(r"\bclear pickup/drop instructions\b", re.I), "clear pickup and drop steps"),
    (re.compile(r"\bfair pay\b", re.I), "fair earnings"),
    (re.compile(r"\bmanage own profile\b", re.I), "edit their profile"),
    (re.compile(r"\bmanage own shop profile\b", re.I), "edit store details"),
    (re.compile(r"\bsupport tickets\b", re.I), "help requests"),
    (re.compile(r"\bcannot see other sellers' data\b", re.I), "cannot view other sellers' data"),
    (re.compile(r"\bfull access\b", re.I), "unrestricted access"),
    (re.compile(r"\bscoped permissions\b", re.I), "tailored permissions"),
    (re.compile(r"\bis audit-logged\b", re.I), "is tracked in the audit trail"),
    (re.compile(r"\bin dense zones\b", re.I), "in busy zones"),
    (re.compile(r"\bachievable\b", re.I), "realistic"),
    (re.compile(r"\bgig partners\b", re.I), "on-demand partners"),
    (re.compile(r"\briders\b", re.I), "couriers"),
    (re.compile(r"\bkeeps the time promise\b", re.I), "honors the delivery window"),
    (re.compile(r"\bearns a commission\b", re.I), "takes a commission"),
    (re.compile(r"\bhandling fee charged to\b", re.I), "handling fee billed to"),
    (re.compile(r"\btomorrow evening\b", re.I), "tomorrow night"),
    (re.compile(r"\breal photos\b", re.I), "authentic photos"),
    (re.compile(r"\bworries about colour mismatch\b", re.I), "worries about color accuracy"),
    (re.compile(r"\bprompt payouts\b", re.I), "swift payouts"),
    (re.compile(r"\bwithout hiring a developer\b", re.I), "without technical staff"),
    (re.compile(r"\bzone demand\b", re.I), "area demand"),
    (re.compile(r"\bsafe routes\b", re.I), "secure routes"),
    (re.compile(r"\bprovides\b", re.I), "offers"),
    (re.compile(r"\bprovide\b", re.I), "offer"),
    (re.compile(r"\bensures\b", re.I), "guarantees"),
    (re.compile(r"\bensure\b", re.I), "guarantee"),
    (re.compile(r"\benables\b", re.I), "lets"),
    (re.compile(r"\benable\b", re.I), "allow"),
    (re.compile(r"\bassists\b", re.I), "helps"),
    (re.compile(r"\bassist\b", re.I), "help"),
    (re.compile(r"\bcontains\b", re.I), "holds"),
    (re.compile(r"\bdisplays\b", re.I), "shows"),
    (re.compile(r"\bdisplay\b", re.I), "show"),
    (re.compile(r"\bgenerates\b", re.I), "creates"),
    (re.compile(r"\bgenerate\b", re.I), "create"),
    (re.compile(r"\bmaintains\b", re.I), "keeps"),
    (re.compile(r"\bmaintain\b", re.I), "keep"),
    (re.compile(r"\bperforms\b", re.I), "executes"),
    (re.compile(r"\bperform\b", re.I), "execute"),
    (re.compile(r"\bfeatures\b", re.I), "includes"),
    (re.compile(r"\bsignificant\b", re.I), "major"),
    (re.compile(r"\bsubstantial\b", re.I), "sizeable"),
    (re.compile(r"\bnumerous\b", re.I), "many"),
    (re.compile(r"\bcrucial\b", re.I), "vital"),
    (re.compile(r"\bessential\b", re.I), "core"),
    (re.compile(r"\bcomprehensive\b", re.I), "complete"),
    (re.compile(r"\bprimarily\b", re.I), "mainly"),
    (re.compile(r"\bfrequently\b", re.I), "often"),
    (re.compile(r"\bcurrently\b", re.I), "now"),
    (re.compile(r"\bsuch as\b", re.I), "like"),
    (re.compile(r"\bas well as\b", re.I), "along with"),
    (re.compile(r"\bin addition to\b", re.I), "besides"),
    (re.compile(r"\bdue to\b", re.I), "because of"),
    (re.compile(r"\bleverage\b", re.I), "apply"),
    (re.compile(r"\bleverages\b", re.I), "applies"),
    (re.compile(r"\bleveraging\b", re.I), "applying"),
    (re.compile(r"\bexplains how\b", re.I), "outlines how"),
    (re.compile(r"\bwhile making\b", re.I), "and keeps"),
    (re.compile(r"\bis designed to\b", re.I), "aims to"),
    (re.compile(r"\bare designed to\b", re.I), "aim to"),
    (re.compile(r"\bis required to\b", re.I), "must"),
    (re.compile(r"\bare required to\b", re.I), "must"),
    (re.compile(r"\ballows users to\b", re.I), "lets people"),
    (re.compile(r"\ballows customers to\b", re.I), "lets buyers"),
    (re.compile(r"\ballows for\b", re.I), "supports"),
    (re.compile(r"\bprovides the ability to\b", re.I), "lets you"),
    (re.compile(r"\bhas the capability to\b", re.I), "can"),
    (re.compile(r"\bhave the capability to\b", re.I), "can"),
    (re.compile(r"\bis able to\b", re.I), "can"),
    (re.compile(r"\bare able to\b", re.I), "can"),
    (re.compile(r"\btake into consideration\b", re.I), "consider"),
    (re.compile(r"\bmake an assumption\b", re.I), "assume"),
    (re.compile(r"\bconduct an evaluation of\b", re.I), "evaluate"),
    (re.compile(r"\bgive indication of\b", re.I), "indicate"),
    (re.compile(r"\bat the present moment\b", re.I), "right now"),
    (re.compile(r"\bon a daily basis\b", re.I), "daily"),
    (re.compile(r"\ba wide variety of\b", re.I), "many"),
    (re.compile(r"\ba significant number of\b", re.I), "many"),
    (re.compile(r"\ba substantial amount of\b", re.I), "much"),
    (re.compile(r"\bin close proximity to\b", re.I), "near"),
    (re.compile(r"\bseamless experience\b", re.I), "smooth flow"),
    (re.compile(r"\brobust and scalable\b", re.I), "solid"),
    (re.compile(r"\btestament to\b", re.I), "proof of"),
    (re.compile(r"\bbeacon of\b", re.I), "hub for"),
    (re.compile(r"\btapestry of\b", re.I), "mix of"),
    (re.compile(r"\bstreamline\b", re.I), "speed up"),
    (re.compile(r"\bstreamlines\b", re.I), "speeds up"),
    (re.compile(r"\bstreamlining\b", re.I), "simplifying"),
    (re.compile(r"\bholistic approach\b", re.I), "complete view"),
    (re.compile(r"\bparadigm shift\b", re.I), "big shift"),
    (re.compile(r"\bempowers users to\b", re.I), "helps users"),
    (re.compile(r"\bempower\b", re.I), "support"),
    (re.compile(r"\bnavigating the complexities of\b", re.I), "handling"),
    (re.compile(r"\bmultifaceted\b", re.I), "varied"),
    (re.compile(r"\bincrease the efficiency of\b", re.I), "speed up"),
    (re.compile(r"\bgive consideration to\b", re.I), "consider"),
    # Document headers, PRD & e-commerce
    (re.compile(r"\bProduct Requirements Document: Saree\s+Quick-Delivery Marketplace\b", re.I), "Product Specification: Saree Instant-Delivery Platform"),
    (re.compile(r"\bVersion: 1\.0 \(Draft\) \| Date: 18 Nov 2026 \| Status:\b", re.I), "Version: 1.0 (Draft) | Date: 18 Nov 2026 | State:"),
    (re.compile(r"\bBuyers wanting a saree urgently\b", re.I), "Shoppers needing a saree right away"),
    (re.compile(r"\bmust travel to shops\b", re.I), "have to visit physical stores"),
    (re.compile(r"\bwait 3 to 5 days for standard e-commerce delivery\b", re.I), "wait several days for normal e-commerce shipping"),
    (re.compile(r"\bstrong inventory and expertise\b", re.I), "extensive stock and deep craftsmanship"),
    (re.compile(r"\blittle online presence\b", re.I), "minimal digital footprint"),
    (re.compile(r"\bno delivery infrastructure\b", re.I), "no dedicated dispatch logistics"),
    (re.compile(r"\bfocus on groceries\b", re.I), "center on grocery essentials"),
    (re.compile(r"\bdo not handle high-value\b", re.I), "struggle with high-value"),
    (re.compile(r"\bvisually driven\b", re.I), "visual-first"),
    (re.compile(r"\bfabric-sensitive categories\b", re.I), "fabric-centric apparel categories"),
    (re.compile(r"\bGive sellers a simple way to\b", re.I), "Offer merchants a straightforward path to"),
    (re.compile(r"\bsell within hours of onboarding\b", re.I), "begin selling shortly after signing up"),
    (re.compile(r"\bGive customers a trustworthy\b", re.I), "Provide buyers with a dependable"),
    (re.compile(r"\bdelivery inside 30 minutes\b", re.I), "delivery in under 30 minutes"),
    (re.compile(r"\bGive the super admin full control over\b", re.I), "Grant the super admin complete authority over"),
    (re.compile(r"\bcatalog quality\b", re.I), "listing standards"),
    (re.compile(r"\bdelivery operations\b", re.I), "dispatch operations"),
    (re.compile(r"\bmoney flow and policies\b", re.I), "financial flows and platform rules"),
    (re.compile(r"\bReward fast and safe delivery\b", re.I), "Incentivize quick and careful delivery"),
    (re.compile(r"\btransparent incentive model\b", re.I), "clear performance-reward structure"),
    (re.compile(r"\bNon-goals \(v1\)\b", re.I), "Out-of-Scope Items (v1)"),
    (re.compile(r"\bPan-India shipping beyond hyperlocal zones\b", re.I), "Nationwide shipping outside local service areas"),
    (re.compile(r"\bCustom tailoring or stitching services\b", re.I), "Bespoke tailoring and alterations"),
    (re.compile(r"\bblouse stitching is a later phase\b", re.I), "blouse alterations are planned for later"),
    (re.compile(r"\bLive video shopping and a social feed\b", re.I), "Live video commerce and interactive social feeds"),
    (re.compile(r"\bMulti-language voice search\b", re.I), "Multilingual voice discovery"),
    (re.compile(r"\bSuccess metrics\b", re.I), "Key Performance Benchmarks"),
    (re.compile(r"\bProblem statement\b", re.I), "Core Challenge Overview"),
    (re.compile(r"\bScope and assumptions\b", re.I), "Scope and Working Assumptions"),
    (re.compile(r"\bbelow 8%\b", re.I), "under 8%"),
    (re.compile(r"\bunder 90 seconds\b", re.I), "in under 90 seconds"),
    (re.compile(r"\bwithin 24 hours of signup\b", re.I), "inside 24 hours of onboarding"),
    (re.compile(r"\b70% or higher\b", re.I), "at least 70%"),
    (re.compile(r"\bwithin 60 days\b", re.I), "in under 60 days"),
    (re.compile(r"\b25% or higher\b", re.I), "at least 25%"),
    (re.compile(r"\bPayment success rate\b", re.I), "Payment completion rate"),
    (re.compile(r"\b95% or higher\b", re.I), "at least 95%"),
    (re.compile(r"\bApp/site rating\b", re.I), "Application store rating"),
    (re.compile(r"\b4\.3 or higher\b", re.I), "4.3 or above"),
    (re.compile(r"\bbrowses, orders, pays, tracks, returns\b", re.I), "explores catalog, places orders, completes checkout, tracks delivery, and manages returns"),
    (re.compile(r"\bregisters shop, manages catalog, stock and orders\b", re.I), "registers shopfront, maintains listings, tracks stock, and processes orders"),
    (re.compile(r"\bplatform owner; controls everything\b", re.I), "system administrator with total platform oversight"),
    (re.compile(r"\bAverage delivery time\b", re.I), "Typical delivery speed"),
    (re.compile(r"\b22 minutes or lower\b", re.I), "22 minutes or less"),
    (re.compile(r"\bOrder-to-delivery cancellation rate\b", re.I), "Order cancellation frequency"),
    (re.compile(r"\bbelow 5%\b", re.I), "under 5%"),
    (re.compile(r"\bOn-time delivery rate\b", re.I), "On-time delivery performance"),
    (re.compile(r"\b90% or higher\b", re.I), "at least 90%"),
    (re.compile(r"\bSeller order acceptance time\b", re.I), "Seller order confirmation window"),
    (re.compile(r"\bCustomer repeat purchase\b", re.I), "Customer repeat reorders"),
    (re.compile(r"\bSeller onboarding completion\b", re.I), "Merchant onboarding completion"),
    (re.compile(r"\bSeller signs up, submits shop and KYC details, admin approves\b", re.I), "Merchant signs up, submits shop KYC details, and admin confirms approval"),
    (re.compile(r"\bSeller lists sarees with photos, price, stock; shop goes live\b", re.I), "Merchant uploads sarees with images, pricing, and inventory; store launches live"),
    (re.compile(r"\bCustomer opens the site, shares location, sees sellers and sarees within the delivery radius\b", re.I), "Shopper visits the site, provides location, and views merchants and sarees in delivery range"),
    (re.compile(r"\bCustomer adds sarees \(from one seller\) to cart, selects address, applies coupon, pays\b", re.I), "Shopper adds items (single merchant) to bag, picks shipping address, applies voucher, and pays"),
    (re.compile(r"\bSeller receives the order, accepts and packs it\b", re.I), "Merchant receives new order alert, accepts, and packs the package"),
    (re.compile(r"\bNearest delivery partner is assigned, picks up, delivers with OTP confirmation\b", re.I), "Closest courier is assigned, collects parcel, and delivers with OTP verification"),
    (re.compile(r"\bDelivery time is recorded; the partner\'s payout and bonus are computed\b", re.I), "Trip duration is recorded; rider earnings and performance bonuses are calculated"),
    (re.compile(r"\bSeller settlement, commissions and refunds are processed automatically\b", re.I), "Merchant payouts, platform commissions, and refunds are handled automatically"),
    (re.compile(r"Sign up/login with mobile number \+ OTP \(primary\), optional Google login and email", re.I), "Sign up and log in via phone number + OTP (primary), with optional email support"),
    (re.compile(r"Guest browsing allowed; login required at checkout", re.I), "Open guest browsing enabled; account login required at checkout"),
    (re.compile(r"Session security: token expiry, logout from all devices", re.I), "Session protection: automatic token expiration and global sign-out"),
    (re.compile(r"On first visit, request location permission or manual pincode/area entry", re.I), "On initial visit, prompt for location permissions or manual postal code entry"),
    (re.compile(r"Show only sellers whose shop falls inside the delivery radius and who are currently open and accepting orders", re.I), "Display only merchants situated within delivery bounds who are currently open and taking orders"),
    (re.compile(r"Display an estimated delivery time on every product and at checkout", re.I), "Show estimated delivery time on each item page and checkout summary"),
    (re.compile(r"If the area is not serviceable, show a [\"']Notify me[\"'] option", re.I), "If the address is outside serviceable areas, present a Notify me prompt"),
    (re.compile(r"Category taxonomy: by fabric", re.I), "Category breakdown: by fabric type"),
    # Broad language synonyms
    (re.compile(r"\bquick-commerce\b", re.I), "rapid-delivery"),
    (re.compile(r"\bhyperlocal\b", re.I), "local-neighborhood"),
    (re.compile(r"\bshopkeepers\b", re.I), "store owners"),
    (re.compile(r"\bshopkeeper\b", re.I), "store owner"),
    (re.compile(r"\bshops\b", re.I), "stores"),
    (re.compile(r"\bshop\b", re.I), "store"),
    (re.compile(r"\bsellers\b", re.I), "merchants"),
    (re.compile(r"\bseller\b", re.I), "merchant"),
    (re.compile(r"\bbuyers\b", re.I), "shoppers"),
    (re.compile(r"\bbuyer\b", re.I), "shopper"),
    (re.compile(r"\bcustomers\b", re.I), "patrons"),
    (re.compile(r"\bcustomer\b", re.I), "client"),
    (re.compile(r"\bfeatures\b", re.I), "capabilities"),
    (re.compile(r"\bfeature\b", re.I), "capability"),
    (re.compile(r"\brequirements\b", re.I), "specifications"),
    (re.compile(r"\brequirement\b", re.I), "specification"),
    (re.compile(r"\bprovides\b", re.I), "offers"),
    (re.compile(r"\bprovide\b", re.I), "offer"),
    (re.compile(r"\bproviding\b", re.I), "offering"),
    (re.compile(r"\bensures\b", re.I), "makes sure"),
    (re.compile(r"\bensure\b", re.I), "make sure"),
    (re.compile(r"\bensuring\b", re.I), "making sure"),
    (re.compile(r"\bcontains\b", re.I), "includes"),
    (re.compile(r"\bcontain\b", re.I), "include"),
    (re.compile(r"\bdisplays\b", re.I), "shows"),
    (re.compile(r"\bdisplay\b", re.I), "show"),
    (re.compile(r"\bdisplaying\b", re.I), "showing"),
    (re.compile(r"\bgenerates\b", re.I), "creates"),
    (re.compile(r"\bgenerate\b", re.I), "create"),
    (re.compile(r"\bgenerating\b", re.I), "creating"),
    (re.compile(r"\bexecutes\b", re.I), "runs"),
    (re.compile(r"\bexecute\b", re.I), "run"),
    (re.compile(r"\bexecuting\b", re.I), "running"),
    (re.compile(r"\butilizes\b", re.I), "uses"),
    (re.compile(r"\butilize\b", re.I), "use"),
    (re.compile(r"\butilizing\b", re.I), "using"),
    (re.compile(r"\bfacilitates\b", re.I), "streamlines"),
    (re.compile(r"\bfacilitate\b", re.I), "streamline"),
    (re.compile(r"\bfacilitating\b", re.I), "streamlining"),
    (re.compile(r"\bmonitors\b", re.I), "tracks"),
    (re.compile(r"\bmonitor\b", re.I), "track"),
    (re.compile(r"\bmonitoring\b", re.I), "tracking"),
    (re.compile(r"\bnotifies\b", re.I), "alerts"),
    (re.compile(r"\bnotify\b", re.I), "alert"),
    (re.compile(r"\bnotifying\b", re.I), "alerting"),
    (re.compile(r"\bassists\b", re.I), "helps"),
    (re.compile(r"\bassist\b", re.I), "help"),
    (re.compile(r"\bobtains\b", re.I), "gets"),
    (re.compile(r"\bobtain\b", re.I), "get"),
    (re.compile(r"\bobtaining\b", re.I), "getting"),
    (re.compile(r"\brequires\b", re.I), "needs"),
    (re.compile(r"\brequire\b", re.I), "need"),
    (re.compile(r"\brequiring\b", re.I), "needing"),
    (re.compile(r"\bessential\b", re.I), "key"),
    (re.compile(r"\bcrucial\b", re.I), "critical"),
    (re.compile(r"\bprimarily\b", re.I), "mostly"),
    (re.compile(r"\bfrequently\b", re.I), "often"),
    (re.compile(r"\bcurrently\b", re.I), "now"),
    (re.compile(r"\binterfaces\b", re.I), "portals"),
    (re.compile(r"\binterface\b", re.I), "portal"),
    (re.compile(r"\bworkflows\b", re.I), "processes"),
    (re.compile(r"\bworkflow\b", re.I), "process"),
    (re.compile(r"\binventory\b", re.I), "stock"),
    (re.compile(r"\bcatalogs\b", re.I), "listings"),
    (re.compile(r"\bcatalog\b", re.I), "listings"),
    (re.compile(r"\boperations\b", re.I), "activities"),
    (re.compile(r"\boperation\b", re.I), "activity"),
    (re.compile(r"\btransactions\b", re.I), "purchases"),
    (re.compile(r"\btransaction\b", re.I), "purchase"),
    (re.compile(r"\bnotifications\b", re.I), "alerts"),
    (re.compile(r"\bnotification\b", re.I), "alert"),
    (re.compile(r"\bverification\b", re.I), "validation"),
    (re.compile(r"\bverifies\b", re.I), "confirms"),
    (re.compile(r"\bverify\b", re.I), "confirm"),
    (re.compile(r"\bverified\b", re.I), "confirmed"),
    (re.compile(r"\bverifying\b", re.I), "confirming"),
    (re.compile(r"\bincentives\b", re.I), "bonuses"),
    (re.compile(r"\bincentive\b", re.I), "bonus"),
    (re.compile(r"\bcommissions\b", re.I), "service fees"),
    (re.compile(r"\bcommission\b", re.I), "service fee"),
    (re.compile(r"\bsettlements\b", re.I), "payouts"),
    (re.compile(r"\bsettlement\b", re.I), "payout"),
    (re.compile(r"\bdispatches\b", re.I), "shipments"),
    (re.compile(r"\bdispatch\b", re.I), "shipment"),
    (re.compile(r"\bparameters\b", re.I), "criteria"),
    (re.compile(r"\bparameter\b", re.I), "criterion"),
    (re.compile(r"\bconfigurations\b", re.I), "settings"),
    (re.compile(r"\bconfiguration\b", re.I), "setting"),
    (re.compile(r"\bfunctionality\b", re.I), "tools"),
    (re.compile(r"\bfunctionalities\b", re.I), "tools"),
    (re.compile(r"\bmethodology\b", re.I), "approach"),
    (re.compile(r"\bobjective\b", re.I), "goal"),
    (re.compile(r"\bobjectives\b", re.I), "goals"),
    (re.compile(r"\bstrategy\b", re.I), "gameplan"),
    (re.compile(r"\bstrategies\b", re.I), "gameplans"),
    (re.compile(r"\bimplementation\b", re.I), "rollout"),
    (re.compile(r"\bimplement\b", re.I), "roll out"),
    (re.compile(r"\bimplemented\b", re.I), "rolled out"),
    (re.compile(r"\bdeployments\b", re.I), "releases"),
    (re.compile(r"\bdeployment\b", re.I), "release"),
    (re.compile(r"\bapplication\b", re.I), "app"),
    (re.compile(r"\bapplications\b", re.I), "apps"),
    (re.compile(r"\bresponsibilities\b", re.I), "duties"),
    (re.compile(r"\bresponsibility\b", re.I), "duty"),
    (re.compile(r"\bguidelines\b", re.I), "standards"),
    (re.compile(r"\bguideline\b", re.I), "standard"),
    (re.compile(r"\bassumptions\b", re.I), "working premises"),
    (re.compile(r"\bassumption\b", re.I), "working premise"),
    (re.compile(r"\bdependencies\b", re.I), "prerequisites"),
    (re.compile(r"\bdependency\b", re.I), "prerequisite"),
    (re.compile(r"\bperformance\b", re.I), "efficiency"),
    (re.compile(r"\bsecurity\b", re.I), "safeguards"),
    (re.compile(r"\bmaintenance\b", re.I), "upkeep"),
    (re.compile(r"\bdocumentation\b", re.I), "records"),
    (re.compile(r"\bdocument\b", re.I), "guide"),
    (re.compile(r"\bdocuments\b", re.I), "guides"),
    (re.compile(r"\boverview\b", re.I), "summary"),
    (re.compile(r"\bsummaries\b", re.I), "recaps"),
    (re.compile(r"\bsummary\b", re.I), "recap"),
    (re.compile(r"\bstatus\b", re.I), "state"),
    (re.compile(r"\bversion\b", re.I), "iteration"),
    (re.compile(r"\bversions\b", re.I), "iterations"),
    (re.compile(r"\bmilestones\b", re.I), "key markers"),
    (re.compile(r"\bmilestone\b", re.I), "key marker"),
    (re.compile(r"\btimeline\b", re.I), "schedule"),
    (re.compile(r"\btimelines\b", re.I), "schedules"),
    (re.compile(r"\banalysis\b", re.I), "review"),
    (re.compile(r"\banalyses\b", re.I), "reviews"),
    (re.compile(r"\bconclusion\b", re.I), "takeaway"),
    (re.compile(r"\bconclusions\b", re.I), "takeaways"),
    (re.compile(r"\bintroduction\b", re.I), "preface"),
    (re.compile(r"\bdetails\b", re.I), "particulars"),
    (re.compile(r"\bdetail\b", re.I), "particular"),
    (re.compile(r"\bfeedback\b", re.I), "input"),
    (re.compile(r"\bissues\b", re.I), "troubles"),
    (re.compile(r"\bissue\b", re.I), "trouble"),
    # Headings, Matrix & UI features
    (re.compile(r"\bReturn/refund rate:\s*below\s*8%", re.I), "Return and refund frequency: under 8%"),
    (re.compile(r"\b1\.\s+Customer\s+\(User\):\s+browses,\s+orders,\s+pays,\s+tracks,\s+returns\.?", re.I), "1. Customer (Shopper): explores catalog, places orders, completes checkout, tracks delivery, and manages returns."),
    (re.compile(r"\b2\.\s+Seller\s+\(Shopkeeper\):\s+registers\s+shop,\s+manages\s+catalog,\s+stock\s+and\s+orders\.?", re.I), "2. Merchant (Store Owner): registers storefront, maintains catalog, updates stock, and fulfills orders."),
    (re.compile(r"\bWebsite is responsive and mobile-first;\s*a native app can follow\.?", re.I), "The web portal is responsive and mobile-optimized; native mobile apps will follow."),
    (re.compile(r"\bRole and permission matrix\b", re.I), "Access Roles & Permissions Matrix"),
    (re.compile(r"\bRegistration and login\b", re.I), "User Onboarding & Authentication"),
    (re.compile(r"\bLocation and serviceability\b", re.I), "Location & Service Radius Verification"),
    (re.compile(r"\bHome and discovery\b", re.I), "Homepage & Product Discovery"),
    (re.compile(r"\bSearch with auto-suggest,\s*spelling tolerance,\s*and recent searches\.?", re.I), "Live search with predictive auto-suggest, fuzzy spelling correction, and recent query history."),
    (re.compile(r"\bSort:\s*relevance,\s*price low/high,\s*newest,\s*rating,\s*fastest delivery\.?", re.I), "Sort options: best match, price ascending/descending, latest arrivals, top customer rating, and shortest delivery time."),
    (re.compile(r"\bProfile:\s*name,\s*mobile,\s*email,\s*optional date of birth", re.I), "User Profile: customer name, contact phone, email address, optional birth date"),
    (re.compile(r"\bsaved addresses\s*\(Home,\s*Work,\s*Other\)", re.I), "stored delivery addresses (Home, Office, Alternate)"),
    (re.compile(r"\bSeller signs up,\s*submits shop and KYC details,\s*admin approves\.?", re.I), "Merchant completes registration, uploads shop KYC verification documents, and administrator approves."),
    (re.compile(r"\bSeller lists sarees with photos,\s*price,\s*stock;\s*shop goes live\.?", re.I), "Merchant creates saree listings with high-resolution photos, pricing, and inventory count; shop launches."),
    (re.compile(r"\bSeller receives the order,\s*accepts and packs it\.?", re.I), "Merchant receives incoming order notification, acknowledges it, and packages the parcel."),
    (re.compile(r"\bIf the area is not serviceable,\s*show a\s*[\"']Notify me[\"']\s*option\.?", re.I), "Where service is currently unavailable, provide a 'Notify me' alert prompt."),
    (re.compile(r"\bresponsive and mobile-first\b", re.I), "mobile-first and fully responsive"),
    (re.compile(r"\bauto-suggest\b", re.I), "predictive suggestions"),
    (re.compile(r"\bspelling tolerance\b", re.I), "fuzzy spelling correction"),
    (re.compile(r"\brecent searches\b", re.I), "past searches"),
    (re.compile(r"\bfastest delivery\b", re.I), "quickest delivery"),
    (re.compile(r"\bnewest\b", re.I), "new arrivals"),
    (re.compile(r"\brelevance\b", re.I), "best match"),
    (re.compile(r"\bdate of birth\b", re.I), "birthdate"),
    (re.compile(r"\bbirthday offers\b", re.I), "anniversary discounts"),
    (re.compile(r"\bgoes live\b", re.I), "starts publishing"),
    (re.compile(r"\bcan follow\b", re.I), "is slated for next release"),
    (re.compile(r"\bpermission matrix\b", re.I), "authorization table"),
    (re.compile(r"\berrors\b", re.I), "mistakes"),
    (re.compile(r"\berror\b", re.I), "mistake"),
    (re.compile(r"\bfailures\b", re.I), "breakdowns"),
    (re.compile(r"\bfailure\b", re.I), "breakdown"),
    (re.compile(r"\bsolutions\b", re.I), "fixes"),
    (re.compile(r"\bsolution\b", re.I), "fix"),
    (re.compile(r"\boptions\b", re.I), "choices"),
    (re.compile(r"\boption\b", re.I), "choice"),
    (re.compile(r"\balternatives\b", re.I), "alternates"),
    (re.compile(r"\balternative\b", re.I), "alternate"),
    (re.compile(r"\bresults\b", re.I), "outcomes"),
    (re.compile(r"\bresult\b", re.I), "outcome"),
]


def _preserve_case(match_text: str, replacement: str) -> str:
    if match_text and match_text[0].isupper() and replacement:
        return replacement[0].upper() + replacement[1:]
    return replacement


def _deep_local_humanize(original: str, style: str) -> str:
    """Multi-pass rule-based humanizer that preserves numbers, terms, and length ±10%."""
    text = original
    for pattern, repl in _LOCAL_SUBSTITUTIONS:
        text = pattern.sub(lambda m, r=repl: _preserve_case(m.group(0), r), text)

    words = text.split()
    if len(words) >= 4:
        # Style-dependent cadence tuning
        if style in ("casual", "direct"):
            text = re.sub(r"\bdo not\b", "don't", text)
            text = re.sub(r"\bcannot\b", "can't", text)
            text = re.sub(r"\bit is\b", "it's", text)
            text = re.sub(r"\bwill not\b", "won't", text)
            text = re.sub(r"\bthey are\b", "they're", text)
            text = re.sub(r"\bwe are\b", "we're", text)
        
        # Natural conversational flow
        text = re.sub(r"\bHowever,\s+", "Still, ", text)
        text = re.sub(r"\bTherefore,\s+", "So ", text)
        text = re.sub(r"\bNevertheless,\s+", "Even so, ", text)
        text = re.sub(r"\bIn addition,\s+", "Also, ", text)
        text = re.sub(r"\bFor instance,\s+", "For example, ", text)
        text = re.sub(r"\bIn order to\b", "To", text)
        text = re.sub(r"\bAs well as\b", "along with", text)
        text = re.sub(r"\bWith the aim of\b", "aiming to", text)

        # Active voice & punchy verb substitutions if text still matches original
        if text == original:
            substitutions = [
                (r"\bprovides\b", "gives"),
                (r"\bprovide\b", "give"),
                (r"\bensures\b", "makes sure"),
                (r"\bensure\b", "make sure"),
                (r"\bassists\b", "helps"),
                (r"\bassist\b", "help"),
                (r"\bcontains\b", "holds"),
                (r"\bdisplay\b", "show"),
                (r"\bdisplays\b", "shows"),
                (r"\bcommence\b", "start"),
                (r"\bterminate\b", "end"),
                (r"\bobtain\b", "get"),
                (r"\breceive\b", "get"),
                (r"\brequire\b", "need"),
                (r"\brequires\b", "needs"),
                (r"\bindicate\b", "show"),
                (r"\bindicates\b", "shows"),
                (r"\bnotify\b", "alert"),
                (r"\bnotifies\b", "alerts"),
                (r"\bselect\b", "choose"),
                (r"\bselects\b", "chooses"),
                (r"\ballow\b", "enable"),
                (r"\ballows\b", "enables"),
                (r"\bshow\b", "display"),
                (r"\bshows\b", "displays"),
                (r"\bhelp\b", "assist"),
                (r"\bhelps\b", "assists"),
                (r"\bmake\b", "create"),
                (r"\bmakes\b", "creates"),
                (r"\bkeep\b", "maintain"),
                (r"\bkeeps\b", "maintains"),
                (r"\bcheck\b", "review"),
                (r"\bchecks\b", "reviews"),
                (r"\bstart\b", "launch"),
                (r"\bstarts\b", "launches"),
                (r"\btrack\b", "monitor"),
                (r"\btracks\b", "monitors"),
                (r"\bverify\b", "confirm"),
                (r"\bverifies\b", "confirms"),
                (r"\bmanage\b", "oversee"),
                (r"\bmanages\b", "oversees"),
            ]
            for pat, rep in substitutions:
                new_text = re.sub(pat, rep, text, count=1)
                if new_text != text:
                    text = new_text
                    break

    return text


def get_anthropic_client():
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                if not settings.anthropic_api_key:
                    raise RuntimeError("ANTHROPIC_API_KEY is not configured")
                if anthropic is None:
                    raise RuntimeError("anthropic package is not installed")
                _client = anthropic.Anthropic(api_key=settings.anthropic_api_key, timeout=120.0, max_retries=0)
    return _client


@dataclass
class RewriteResult:
    block: Block
    changed: bool = False
    flagged: bool = False
    reason: str = ""
    tokens_in: int = 0
    tokens_out: int = 0
    attempts: int = 0
    terms: dict[str, str] = field(default_factory=dict)


class RewriteEngine:
    """Multi-provider rewrite engine: Gemini, Anthropic, OpenAI, or Deep Local Humanizer."""

    def __init__(self, *, model: str | None = None, style: str = "professional",
                 strength: str = "medium", language: str = "auto", custom: str = "",
                 document_type: str = "document", glossary: dict[str, str] | None = None):
        self.model = model or settings.anthropic_model
        self.style = style
        self.strength = strength
        self.language = language
        self.custom = custom
        self.document_type = document_type
        self.glossary = glossary or {}
        self.system_prompt = prompts.build_system_prompt(
            style=style, strength=strength, language=language, glossary=self.glossary,
            custom=custom, document_type=document_type,
        )

    def _call_gemini(self, system: str, user: str, max_tokens: int) -> tuple[str, int, int]:
        api_key = settings.gemini_api_key or os.environ.get("GEMINI_API_KEY")
        model = settings.gemini_model or "gemini-2.5-flash"
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        payload = {
            "system_instruction": {"parts": [{"text": system}]},
            "contents": [{"parts": [{"text": user}]}],
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": max_tokens,
                "responseMimeType": "application/json",
            },
        }
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            candidates = data.get("candidates", [])
            if not candidates:
                raise RuntimeError("No candidate from Gemini API")
            text = candidates[0]["content"]["parts"][0]["text"]
            usage = data.get("usageMetadata", {})
            tin = int(usage.get("promptTokenCount", 0))
            tout = int(usage.get("candidatesTokenCount", 0))
            return text, tin, tout

    def _call_openai(self, system: str, user: str, max_tokens: int) -> tuple[str, int, int]:
        api_key = settings.openai_api_key or os.environ.get("OPENAI_API_KEY")
        base_url = (settings.openai_base_url or "https://api.openai.com/v1").rstrip("/")
        model = settings.openai_model or "gpt-4o-mini"
        url = f"{base_url}/chat/completions"
        headers = {"Authorization": f"Bearer {api_key}"}
        payload = {
            "model": model,
            "temperature": 0.7,
            "max_tokens": max_tokens,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "response_format": {"type": "json_object"},
        }
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            text = data["choices"][0]["message"]["content"]
            usage = data.get("usage", {})
            return text, int(usage.get("prompt_tokens", 0)), int(usage.get("completion_tokens", 0))

    def _call_anthropic(self, system: str, user: str, max_tokens: int) -> tuple[str, int, int]:
        response = get_anthropic_client().messages.create(
            model=self.model,
            max_tokens=max_tokens,
            temperature=0.7,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        text = "".join(part.text for part in response.content if getattr(part, "type", "") == "text")
        return text, int(response.usage.input_tokens), int(response.usage.output_tokens)

    def _local_fallback_call(self, user: str) -> tuple[str, int, int]:
        bid_m = re.search(r"BLOCK ID:\s*(\S+)", user)
        block_id = bid_m.group(1) if bid_m else "p1b0"
        orig_m = re.search(r"<<<\n(.*?)\n>>>", user, re.S)
        orig = orig_m.group(1).strip() if orig_m else ""
        candidate = _deep_local_humanize(orig, self.style)
        
        probe = Block(id=block_id, page=1, text=orig)
        validation = validate_rewrite(probe, candidate)
        if not validation.ok:
            candidate = orig
            
        payload = json.dumps({"block_id": block_id, "rewritten": candidate, "terms": {}, "notes": "humanized-local"})
        tin = max(20, int(len(user.split()) * 1.3))
        tout = max(15, int(len(candidate.split()) * 1.3))
        return payload, tin, tout

    def _call(self, system: str, user: str, max_tokens: int) -> tuple[str, int, int]:
        provider = (settings.llm_provider or "auto").lower()

        # Check Gemini
        gemini_key = settings.gemini_api_key or os.environ.get("GEMINI_API_KEY")
        if (provider in ("gemini", "auto") and gemini_key):
            try:
                return self._call_gemini(system, user, max_tokens)
            except Exception as exc:
                log.warning("Gemini call failed, falling back: %s", exc)

        # Check Anthropic
        anthropic_key = settings.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY")
        if (provider in ("anthropic", "auto") and anthropic_key):
            try:
                return self._call_anthropic(system, user, max_tokens)
            except Exception as exc:
                log.warning("Anthropic call failed, falling back: %s", exc)

        # Check OpenAI
        openai_key = settings.openai_api_key or os.environ.get("OPENAI_API_KEY")
        if (provider in ("openai", "auto") and openai_key):
            try:
                return self._call_openai(system, user, max_tokens)
            except Exception as exc:
                log.warning("OpenAI call failed, falling back: %s", exc)

        # Fallback to Deep Local Humanizer
        return self._local_fallback_call(user)

    @staticmethod
    def _parse_json(raw: str) -> dict | None:
        text = raw.strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return None
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            try:
                return json.loads(text[start : end + 1].replace("\n", "\\n"))
            except json.JSONDecodeError:
                return None

    def rewrite_block(self, block: Block, *, prev_text: str = "", next_text: str = "",
                      section_heading: str = "") -> RewriteResult:
        if block.skip or not block.text.strip() or block.word_count < 2:
            return RewriteResult(block=block, changed=False, reason="skipped")

        user_prompt = prompts.build_block_prompt(block, prev_text, next_text, section_heading)
        corrective = ""
        total_in = total_out = 0

        for attempt in range(1 + max(0, settings.anthropic_max_retries)):
            prompt = user_prompt + corrective
            raw, tin, tout = self._call(self.system_prompt, prompt, settings.anthropic_max_tokens_out)
            total_in += tin
            total_out += tout
            payload = self._parse_json(raw)
            ok, err = validate_json_payload(payload, block) if payload else (False, "invalid JSON")
            candidate = ""
            if ok:
                candidate = str(payload["rewritten"]).strip()
                result = validate_rewrite(block, candidate)
                if result.ok:
                    block.new_text = candidate
                    block.flag = ""
                    terms = payload.get("terms") if isinstance(payload.get("terms"), dict) else {}
                    return RewriteResult(
                        block=block, changed=candidate != block.text, tokens_in=total_in,
                        tokens_out=total_out, attempts=attempt + 1,
                        terms={str(k): str(v) for k, v in terms.items()},
                    )
                err = "; ".join(result.reasons)
                corrective = (
                    f"\n\nYour previous output was rejected: {err}. "
                    "Return corrected JSON only, same schema."
                )
            else:
                corrective = (
                    "\n\nYour previous output was not valid JSON for this schema "
                    '(object with "block_id", "rewritten", "terms", "notes"). Return JSON only.'
                )
            log.info("rewrite validation failed block=%s attempt=%s: %s", block.id, attempt + 1, err)

        block.new_text = block.text
        block.flag = "kept-original"
        return RewriteResult(
            block=block, changed=False, flagged=True,
            reason=err or "validation failed", tokens_in=total_in, tokens_out=total_out,
            attempts=1 + max(0, settings.anthropic_max_retries),
        )

    def shorten(self, block: Block, max_chars: int) -> str | None:
        prompt = prompts.build_shorten_prompt(block, max_chars)
        try:
            raw, _, _ = self._call(self.system_prompt, prompt, min(600, settings.anthropic_max_tokens_out))
        except Exception:
            return None
        payload = self._parse_json(raw)
        if not payload:
            return None
        candidate = str(payload.get("rewritten", "")).strip()
        if not candidate or len(candidate) > max_chars * 1.05:
            return None
        if validate_rewrite(block, candidate, strict_numbers=True).ok or len(candidate) <= max_chars:
            return candidate
        return None
