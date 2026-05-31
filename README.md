check webhook
Install "ViolentMonkey" browser extension and install this script from https://greasyfork.org/en/scripts/556851-thefork-manager-kitchen-display

Visit your TheFork frontend, there should be a "Affiche cuisine" button on the lower right corner.

Setting up is done, when on TheFork, by clicking the ViolentMonkey icon in your extensions.

Settings available are:

- Configurer le seuil groupe: Defines how many guests make the reservation a "group". A group is detected by the presence of a menu preset or at or above this threshold
- Configurer le rechargement auto: Delax between synchronisation with TheFork. DO NOT GO LOWER THAN 30 SECONDS.
- Configurer les salles: For groups display, instead of displaying table numbers, we display room names. It is much easier to edit this directly from the plugin database instead of this popup. The format is the following:

``` JSON
[
	{
		"label": "Salle à manger",
		"ranges": [
			[
				1,
				9
			]
		]
	},
	{
		"label": "Billard",
		"numbers": [
			49,
			62
		]
	},
	{
		"label": "Jardin d’hiver",
		"numbers": [
			19,
			20
		],
		"ranges": [
			[
				50,
				70
			]
		]
	},
]
```

- "Salle à manger" defines a range of table numbers. Tables numbered from 1 to 9 will be labeled "Salle à manger"
- "Billard" defines table numbers. Tables numbered 49 or 62 will be labeled "Billard"
- "Jardin d'hiver" defines both a range of tables and table numbers. Tables numbered from 50 to 70 AND the tables numbered 19 and 20 will be labeled "Jardin d'hiver"
